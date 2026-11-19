begin;

create role lomi_runtime nologin;
grant usage on schema public to lomi_runtime;
grant execute on function public.reserve_usage(uuid,text,uuid) to lomi_runtime;
grant select on public.app_memberships, public.voice_history to lomi_runtime;

-- SELECT FOR SHARE requires UPDATE on at least one column, as well as the RLS policy below.
grant update (active) on public.app_memberships to lomi_runtime;
grant update (cleanup_pending) on public.voice_history to lomi_runtime;

create policy lomi_runtime_read on public.app_memberships for select to lomi_runtime using (true);
create policy lomi_runtime_lock on public.app_memberships for update to lomi_runtime using (true) with check (false);
create policy lomi_runtime_read on public.voice_history for select to lomi_runtime using (true);
create policy lomi_runtime_cleanup on public.voice_history for update to lomi_runtime
  using (true) with check (deleted and not cleanup_pending);

commit;
