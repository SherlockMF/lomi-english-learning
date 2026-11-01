begin;

create table public.voice_history_revisions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0
);
create table public.voice_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  data jsonb,
  revision bigint not null default 0,
  deleted boolean not null default false,
  cleanup_pending boolean not null default false,
  primary key (user_id, id)
);
create index voice_history_cursor on public.voice_history(user_id, revision);
create table public.voice_history_clears (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  primary key(user_id,request_id)
);
alter table public.voice_history_clears enable row level security;
revoke all on public.voice_history_clears from anon,authenticated;
alter table public.voice_history enable row level security;
alter table public.voice_history_revisions enable row level security;
create policy voice_history_owner on public.voice_history for select to authenticated
  using (user_id = auth.uid() and public.is_active_member());
revoke all on public.voice_history, public.voice_history_revisions from anon, authenticated;
grant select on public.voice_history to authenticated;
grant all on public.voice_history, public.voice_history_revisions to service_role;

create function public.voice_history_lock() returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or not public.is_active_member() then raise exception 'Not authorized' using errcode='42501'; end if;
  insert into public.voice_history_revisions(user_id) values(u) on conflict do nothing;
  perform 1 from public.voice_history_revisions where user_id=u for update;
  return u;
end $$;
revoke all on function public.voice_history_lock() from public;

create function public.voice_history_prepare(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.voice_history_lock(); r public.voice_history;
begin
  insert into public.voice_history(user_id,id) values(u,p_id) on conflict do nothing;
  select * into r from public.voice_history where user_id=u and id=p_id;
  return jsonb_build_object('id',r.id,'data',r.data,'revision',r.revision,'deleted',r.deleted);
end $$;

create function public.voice_history_apply(p_id uuid, p_expected_revision bigint, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.voice_history_lock(); r public.voice_history; next_revision bigint; turn jsonb;
begin
  select * into r from public.voice_history where user_id=u and id=p_id for update;
  if r.deleted then return jsonb_build_object('id',r.id,'data',null,'revision',r.revision,'deleted',true); end if;
  if p_data is not null then
    if coalesce(r.revision,0) <> p_expected_revision then raise exception 'Voice history changed' using errcode='40001'; end if;
    if jsonb_typeof(p_data) is distinct from 'object' or p_data->>'id' is distinct from p_id::text
      or p_data->>'mode' not in ('realtime','messages') or not (p_data ? 'mode')
      or jsonb_typeof(p_data->'turns') is distinct from 'array'
      or jsonb_typeof(p_data->'corrections') is distinct from 'object'
      or jsonb_typeof(p_data->'createdAt') is distinct from 'string'
      or jsonb_typeof(p_data->'updatedAt') is distinct from 'string'
      or jsonb_typeof(p_data->'scenario') is distinct from 'string'
      or jsonb_typeof(p_data->'description') is distinct from 'string'
      or jsonb_typeof(p_data->'difficulty') is distinct from 'string'
      or jsonb_typeof(p_data->'elapsedSeconds') is distinct from 'number'
      or octet_length(p_data::text) > 2097152 then
      raise exception 'Invalid voice history' using errcode='22023';
    end if;
    if jsonb_array_length(p_data->'turns') > 2000 then raise exception 'Too many turns' using errcode='22023'; end if;
    for turn in select value from jsonb_array_elements(p_data->'turns') loop
      if jsonb_typeof(turn) is distinct from 'object' or jsonb_typeof(turn->'id') is distinct from 'string'
        or jsonb_typeof(turn->'text') is distinct from 'string'
        or turn->>'role' not in ('user','assistant') or not (turn ? 'role')
        or jsonb_typeof(turn->'final') is distinct from 'boolean'
        or jsonb_typeof(turn->'interrupted') is distinct from 'boolean'
        or turn ? 'audio'
        or (turn ? 'audioPath' and (jsonb_typeof(turn->'audioPath') is distinct from 'string'
          or turn->>'audioPath' !~ ('^' || u::text || '/' || p_id::text || '/[a-f0-9]{64}\.wav$'))) then
        raise exception 'Invalid voice turn' using errcode='22023';
      end if;
    end loop;
  end if;
  update public.voice_history_revisions set revision=revision+1 where user_id=u returning revision into next_revision;
  insert into public.voice_history(user_id,id,data,revision,deleted,cleanup_pending)
    values(u,p_id,p_data,next_revision,p_data is null,p_data is null)
    on conflict(user_id,id) do update set data=excluded.data,revision=excluded.revision,deleted=excluded.deleted,cleanup_pending=excluded.cleanup_pending;
  return jsonb_build_object('id',p_id,'data',p_data,'revision',next_revision,'deleted',p_data is null);
end $$;

create function public.voice_history_pull(p_after_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); rows jsonb;
begin
  if u is null or not public.is_active_member() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_after_revision < 0 then raise exception 'Invalid revision' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'data',data,'revision',revision,'deleted',deleted) order by revision),'[]') into rows
    from (select * from public.voice_history where user_id=u and revision>p_after_revision order by revision limit 100) changes;
  return jsonb_build_object('changes',rows,'revision',coalesce((rows->-1->>'revision')::bigint,p_after_revision),'more',jsonb_array_length(rows)=100);
end $$;

create function public.voice_history_clear(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.voice_history_lock(); target uuid;
begin
  if exists(select 1 from public.voice_history_clears where user_id=u and request_id=p_request_id) then return; end if;
  for target in select id from public.voice_history where user_id=u and not deleted loop
    perform public.voice_history_apply(target,0,null);
  end loop;
  insert into public.voice_history_clears(user_id,request_id) values(u,p_request_id);
end $$;

revoke all on function public.voice_history_prepare(uuid), public.voice_history_apply(uuid,bigint,jsonb), public.voice_history_pull(bigint), public.voice_history_clear(uuid) from public;
grant execute on function public.voice_history_prepare(uuid), public.voice_history_apply(uuid,bigint,jsonb), public.voice_history_pull(bigint), public.voice_history_clear(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('voice-history','voice-history',false,52428800,array['audio/wav','audio/x-wav']);

create function public.voice_audio_allowed(object_name text, writing boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); history_id uuid;
begin
  if u is null or not public.is_active_member() or object_name !~ ('^' || u::text || '/[a-f0-9-]{36}/[a-f0-9]{64}\.wav$') then return false; end if;
  begin history_id := split_part(object_name,'/',2)::uuid; exception when invalid_text_representation then return false; end;
  -- The share lock serializes an upload's metadata commit with tombstone writes.
  if writing then
    perform 1 from public.voice_history where user_id=u and id=history_id and not deleted for share;
    return found;
  end if;
  return exists(select 1 from public.voice_history where user_id=u and id=history_id and not deleted);
end $$;
revoke all on function public.voice_audio_allowed(text,boolean) from public;
grant execute on function public.voice_audio_allowed(text,boolean) to authenticated;
create policy voice_audio_read on storage.objects for select to authenticated
  using (bucket_id='voice-history' and public.voice_audio_allowed(name,false));
create policy voice_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id='voice-history' and public.voice_audio_allowed(name,true));
-- Content-addressed paths are immutable; retries accept an existing object, never overwrite it.
commit;
