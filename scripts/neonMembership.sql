begin;

alter table public.app_memberships
  add column plan text not null default 'legacy',
  add column plan_started_at timestamptz,
  add constraint membership_plan_check check (
    (plan = 'legacy' and plan_started_at is null) or
    (plan in ('trial', 'standard') and plan_started_at is not null)
  );

create table public.lomi_allowance_events (
  user_id uuid not null references public.app_memberships(user_id) on delete cascade,
  request_id uuid not null,
  resource text not null check (resource in ('voice', 'credits', 'recording')),
  plan text not null check (plan in ('trial', 'standard')),
  period_start timestamptz not null,
  reserved integer not null check (reserved > 0),
  units integer not null check (units between 1 and reserved),
  settled boolean not null,
  released boolean not null default false,
  primary key (user_id, resource, request_id)
);
create index lomi_allowance_events_period on public.lomi_allowance_events(user_id, plan, resource, period_start);
alter table public.lomi_allowance_events enable row level security;
revoke all on public.lomi_allowance_events from public, anonymous, authenticated;

create function public.lomi_allowance(member public.app_memberships, p_resource text, at_time timestamptz)
returns table(period_start timestamptz, remaining integer)
language sql stable set search_path = '' as $$
  with allowance as (
    select case when member.plan = 'trial' then member.plan_started_at
      when p_resource = 'voice' then date_trunc('day', at_time at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'
      else date_trunc('month', at_time at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur' end as starts,
    case when member.plan = 'trial' and p_resource = 'recording' then 67108864
      when member.plan = 'trial' and at_time >= member.plan_started_at + interval '360 hours' then 0
      when member.plan = 'trial' and p_resource = 'voice' then 600000
      when member.plan = 'trial' then 1000
      when member.plan = 'standard' and p_resource = 'voice' then 1800000
      when member.plan = 'standard' then 5000
      else 0 end as budget
  )
  select starts, greatest(budget - coalesce(sum(e.units), 0), 0)::integer
  from allowance left join public.lomi_allowance_events e
    on e.user_id = member.user_id and e.plan = member.plan and e.resource = p_resource and e.period_start = starts and not e.released
  group by starts, budget
$$;

create function public.lomi_membership() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (auth.user_id())::uuid;
  member public.app_memberships%rowtype;
  verified boolean;
  at_time timestamptz := statement_timestamp();
begin
  if uid is null then return jsonb_build_object('active', false); end if;
  select * into member from public.app_memberships where user_id = uid;
  if not found then
    select u."emailVerified" into verified from neon_auth."user" u
      where u.id = uid and not coalesce(u.banned, false) and exists (
        select 1 from neon_auth.account a where a."userId" = u.id and a."providerId" = 'credential' and a.password is not null
      );
    if verified is false then return jsonb_build_object('active', false, 'needs_verification', true); end if;
    if verified is distinct from true then return jsonb_build_object('active', false); end if;
    insert into public.app_memberships(user_id, plan, plan_started_at)
      values (uid, 'trial', at_time) on conflict (user_id) do nothing;
    select * into member from public.app_memberships where user_id = uid;
  end if;
  if member.active is distinct from true then return jsonb_build_object('active', false); end if;
  if member.plan = 'legacy' then return jsonb_build_object('active', true, 'plan', 'legacy'); end if;
  return jsonb_build_object('active', true, 'plan', member.plan,
    'expires_at', case when member.plan = 'trial' then member.plan_started_at + interval '360 hours' end,
    'trial_expired', member.plan = 'trial' and at_time >= member.plan_started_at + interval '360 hours',
    'voice_ms', (select remaining from public.lomi_allowance(member, 'voice', at_time)),
    'credits', (select remaining from public.lomi_allowance(member, 'credits', at_time)));
end
$$;

create function public.lomi_reserve_allowance(p_user_id uuid, p_resource text, p_request_id uuid, p_units integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member public.app_memberships%rowtype;
  previous public.lomi_allowance_events%rowtype;
  kind text := case p_resource when 'voice' then 'voice_message' when 'credits' then 'deepseek' end;
  starts timestamptz;
  remaining integer;
  at_time timestamptz;
begin
  if (kind is null and p_resource is distinct from 'recording') or p_user_id is null or p_request_id is null or p_units is null or p_units < 1 then
    raise exception 'Invalid allowance request' using errcode = '22023';
  end if;
  select * into member from public.app_memberships where user_id = p_user_id for update;
  if member.active is distinct from true then return jsonb_build_object('allowed', false, 'metered', false); end if;
  if p_resource = 'recording' and member.plan <> 'trial' then return jsonb_build_object('allowed', true, 'metered', false); end if;
  if member.plan = 'legacy' then
    return jsonb_build_object('allowed', (public.reserve_usage(p_user_id, kind, p_request_id)->>'allowed')::boolean, 'metered', false);
  end if;
  at_time := clock_timestamp();
  if member.plan = 'trial' and p_resource <> 'recording' and at_time >= member.plan_started_at + interval '360 hours' then
    return jsonb_build_object('allowed', false, 'metered', true);
  end if;
  select a.period_start, a.remaining into starts, remaining from public.lomi_allowance(member, p_resource, at_time) a;
  select * into previous from public.lomi_allowance_events
    where user_id = p_user_id and resource = p_resource and request_id = p_request_id;
  if found then
    if previous.reserved <> p_units then raise exception 'Allowance request changed' using errcode = '22023'; end if;
    return jsonb_build_object('allowed', not previous.released and previous.plan = member.plan and previous.period_start = starts, 'metered', true);
  end if;
  if p_units > remaining then return jsonb_build_object('allowed', false, 'metered', true); end if;
  insert into public.lomi_allowance_events(user_id, request_id, resource, plan, period_start, reserved, units, settled)
    values (p_user_id, p_request_id, p_resource, member.plan, starts, p_units, p_units, p_resource <> 'credits');
  return jsonb_build_object('allowed', true, 'metered', true);
end
$$;

create function public.lomi_settle_credits(p_user_id uuid, p_request_id uuid, p_units integer)
returns void language sql security definer set search_path = '' as $$
  update public.lomi_allowance_events set units = greatest(1, least(reserved, p_units)), settled = true, released = p_units = 0
    where user_id = p_user_id and resource = 'credits' and request_id = p_request_id
      and not settled and p_units >= 0
$$;

create function public.lomi_can_start_voice(p_user_id uuid, p_realtime boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select m.active and case
    when p_realtime then m.plan in ('legacy', 'standard')
    when m.plan = 'legacy' then true
    else (select remaining >= 1000 from public.lomi_allowance(m, 'voice', statement_timestamp()))
    end from public.app_memberships m where m.user_id = p_user_id), false)
$$;

revoke all on function public.lomi_allowance(public.app_memberships,text,timestamptz),
  public.lomi_membership(), public.lomi_reserve_allowance(uuid,text,uuid,integer),
  public.lomi_settle_credits(uuid,uuid,integer), public.lomi_can_start_voice(uuid,boolean) from public, anonymous, authenticated;
grant execute on function public.lomi_membership() to authenticated;
grant execute on function public.lomi_reserve_allowance(uuid,text,uuid,integer),
  public.lomi_settle_credits(uuid,uuid,integer), public.lomi_can_start_voice(uuid,boolean) to lomi_runtime;

commit;
