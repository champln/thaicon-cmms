-- Default-OFF narrow acknowledgement. No historical acknowledgement rewrite.
create table private.alarm_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.alarm_settings values(true,false);
revoke all on private.alarm_settings from public,anon,authenticated;
create function private.alarm_commands_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from private.alarm_settings where singleton),false);
$$;
revoke all on function private.alarm_commands_enabled() from public,anon;
grant execute on function private.alarm_commands_enabled() to authenticated;
create function public.alarm_commands_ready() returns boolean language sql stable security definer set search_path='' as $$
 select private.alarm_commands_enabled() and private.current_user_role() is not null;
$$;
revoke all on function public.alarm_commands_ready() from public,anon;
grant execute on function public.alarm_commands_ready() to authenticated;
alter table public.alarms add column version integer not null default 1 check(version>0);
create table public.alarm_events(
 event_no bigint generated always as identity primary key,alarm_id text not null,
 jobsite_id text not null references public.jobsites(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 actor_name text not null,actor_role public.app_role not null,
 request_id uuid not null,request_payload jsonb not null,changed boolean not null,
 alarm_version integer not null check(alarm_version>0),before_snapshot jsonb not null,result_snapshot jsonb not null,
 created_at timestamptz not null default now(),unique(actor_id,request_id)
);
alter table public.alarm_events enable row level security;
create policy "scoped alarm events read" on public.alarm_events for select to authenticated using(private.can_access_jobsite(jobsite_id));
revoke all on public.alarm_events from public,anon,authenticated;
grant select on public.alarm_events to authenticated;
create function private.immutable_alarm_event() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Alarm audit immutable' using errcode='42501';end;$$;
revoke all on function private.immutable_alarm_event() from public,anon,authenticated;
create trigger alarm_events_immutable before update or delete on public.alarm_events for each row execute function private.immutable_alarm_event();
create function private.guard_alarm_command_write() returns trigger language plpgsql set search_path='' as $$
declare owner_write boolean;
begin
 select current_user=pg_catalog.pg_get_userbyid(c.relowner) into owner_write from pg_catalog.pg_class c where c.oid=tg_relid;
 if private.alarm_commands_enabled() and not owner_write then raise exception 'Use alarm acknowledgement command' using errcode='42501';end if;
 if tg_op='UPDATE' then
   if not owner_write and new.version is distinct from old.version then raise exception 'Server version required' using errcode='42501';end if;
   if new.version=old.version then new.version:=old.version+1;end if;
 elsif tg_op='INSERT' and not owner_write and new.version<>1 then raise exception 'Server version required' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
revoke all on function private.guard_alarm_command_write() from public,anon,authenticated;
create trigger alarms_command_guard before insert or update or delete on public.alarms for each row execute function private.guard_alarm_command_write();
create function public.acknowledge_alarm_command(p_alarm_id text,p_site_id text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;a public.alarms%rowtype;before_row jsonb;
 prior public.alarm_events%rowtype;payload jsonb;result jsonb;changed boolean;event_id bigint;
begin
 if not private.alarm_commands_enabled() then raise exception 'Alarm commands disabled' using errcode='42501';end if;
 select * into actor from public.profiles where id=auth.uid() and is_active;
 if not found or actor.role not in ('admin','engineer') or not private.can_access_jobsite(p_site_id) or not exists(select 1 from public.jobsites where id=p_site_id and is_active) then raise exception 'Not authorized' using errcode='42501';end if;
 if p_request_id is null or p_alarm_id is null or length(p_alarm_id) not between 1 and 100 then raise exception 'Invalid alarm request' using errcode='22023';end if;
 payload:=jsonb_build_object('alarm_id',p_alarm_id,'site_id',p_site_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text||':alarm:'||p_request_id::text,0));
 select * into a from public.alarms where id=p_alarm_id for update;
 if found and a.jobsite_id<>p_site_id then raise exception 'Not authorized' using errcode='42501';end if;
 select * into prior from public.alarm_events where actor_id=actor.id and request_id=p_request_id;
 if found then
   if prior.request_payload<>payload then raise exception 'Request ID reused' using errcode='22023';end if;
   return prior.result_snapshot||jsonb_build_object('event_no',prior.event_no,'replayed',true);
 end if;
 if a.id is null then raise exception 'Alarm missing' using errcode='22023';end if;
 before_row:=to_jsonb(a);changed:=not a.acknowledged;
 if changed then
   update public.alarms set acknowledged=true where id=a.id returning * into a;
 end if;
 result:=jsonb_build_object('alarm',to_jsonb(a),'changed',changed);
 insert into public.alarm_events(alarm_id,jobsite_id,actor_id,actor_name,actor_role,request_id,request_payload,changed,alarm_version,before_snapshot,result_snapshot)
 values(a.id,a.jobsite_id,actor.id,actor.display_name,actor.role,p_request_id,payload,changed,a.version,before_row,result) returning event_no into event_id;
 return result||jsonb_build_object('event_no',event_id,'replayed',false);
end;$$;
revoke all on function public.acknowledge_alarm_command(text,text,uuid) from public,anon;
grant execute on function public.acknowledge_alarm_command(text,text,uuid) to authenticated;
