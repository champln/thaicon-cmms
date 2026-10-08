-- Pending TOR commands. Operator-controlled gate defaults OFF until the new
-- frontend has replaced legacy writes. Do not enable on a published old client.
create table private.work_order_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into private.work_order_settings values(true,false);
revoke all on private.work_order_settings from public,anon,authenticated;
create function private.work_order_commands_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select enabled from private.work_order_settings where singleton),false);
$$;
revoke all on function private.work_order_commands_enabled() from public,anon,authenticated;

alter table public.work_orders
  add column assignee_id uuid references public.profiles(id) on delete restrict,
  add column assigned_by uuid references public.profiles(id) on delete restrict,
  add column assigned_at timestamptz,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column version integer not null default 1 check(version>0),
  add constraint work_order_assignment_complete check (
    (assignee_id is null and assigned_by is null and assigned_at is null)
    or (assignee_id is not null and assigned_by is not null and assigned_at is not null)
  );
create index work_orders_assignee_status_idx on public.work_orders(assignee_id,status,jobsite_id);

-- Events are immutable to app identities; no guessed historical assignments.
create table public.work_order_events (
  event_no bigint generated always as identity primary key,
  work_order_id text not null references public.work_orders(id) on delete restrict,
  jobsite_id text not null references public.jobsites(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  actor_name text not null,
  actor_role public.app_role not null,
  request_id uuid not null,
  command text not null check(command in ('assign','start','submit','approve','return','note')),
  request_payload jsonb not null,
  before_status public.work_order_status not null,
  after_status public.work_order_status not null,
  assignee_id uuid references public.profiles(id) on delete restrict,
  note text,
  order_version integer not null check(order_version>1),
  recorded_at timestamptz not null default clock_timestamp(),
  result_snapshot jsonb not null,
  unique(actor_id,request_id),
  unique(work_order_id,order_version)
);
create index work_order_events_history_idx on public.work_order_events(work_order_id,event_no);
alter table public.work_order_events enable row level security;
revoke all on public.work_order_events from public,anon,authenticated;
grant select on public.work_order_events to authenticated;
create policy work_order_event_read on public.work_order_events for select to authenticated
using(private.can_access_jobsite(jobsite_id) and exists (
  select 1 from public.jobsites s where s.id=jobsite_id and s.is_active
));

-- SECURITY INVOKER: direct callers cannot acquire the owner's write privilege.
-- Only an owner-executed command transaction may set server-managed fields.
create function private.guard_work_order_command_write() returns trigger
language plpgsql set search_path='' as $$
declare owner_write boolean;
begin
  select current_user=pg_catalog.pg_get_userbyid(c.relowner) into owner_write
  from pg_catalog.pg_class c where c.oid='public.work_orders'::regclass;
  if owner_write then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if private.work_order_commands_enabled() then
    raise exception 'Use work order command endpoint' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='INSERT' then
    if new.version<>1 or new.assignee_id is not null or new.assigned_by is not null
      or new.assigned_at is not null or new.started_at is not null or new.completed_at is not null then
      raise exception 'Server-managed work order fields' using errcode='42501';
    end if;
  else
    if row(new.version,new.assignee_id,new.assigned_by,new.assigned_at,new.started_at,new.completed_at)
      is distinct from row(old.version,old.assignee_id,old.assigned_by,old.assigned_at,old.started_at,old.completed_at) then
      raise exception 'Server-managed work order fields' using errcode='42501';
    end if;
    new.version:=old.version+1;
  end if;
  return new;
end;
$$;
-- Gate helper must be callable by the invoker trigger, but returns no secrets.
grant execute on function private.work_order_commands_enabled() to authenticated;
revoke all on function private.guard_work_order_command_write() from public,anon,authenticated;
create trigger work_orders_command_guard before insert or update or delete on public.work_orders
for each row execute function private.guard_work_order_command_write();

create function public.work_order_commands_ready() returns boolean
language sql stable security definer set search_path='' as $$
  select private.work_order_commands_enabled() and private.current_user_role() is not null;
$$;
revoke all on function public.work_order_commands_ready() from public,anon;
grant execute on function public.work_order_commands_ready() to authenticated;

create function public.apply_work_order_command(
  p_order_id text, p_expected_version integer, p_request_id uuid,
  p_command text, p_assignee_id uuid default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.profiles%rowtype;
  target public.profiles%rowtype;
  w public.work_orders%rowtype;
  updated public.work_orders%rowtype;
  prior public.work_order_events%rowtype;
  payload jsonb;
  next_status public.work_order_status;
  event_id bigint;
  clean_note text:=btrim(p_note);
begin
  if not private.work_order_commands_enabled() then
    raise exception 'Work order commands not enabled' using errcode='42501';
  end if;
  select * into actor from public.profiles where id=auth.uid() and is_active;
  if not found or actor.role not in ('admin','engineer') then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if p_request_id is null or p_expected_version is null or p_expected_version<1
    or p_command is null or p_command not in ('assign','start','submit','approve','return','note') then
    raise exception 'Invalid command' using errcode='22023';
  end if;
  if (p_command='assign' and (p_assignee_id is null or p_note is not null))
    or (p_command<>'assign' and p_assignee_id is not null)
    or (p_command not in ('note','return') and p_note is not null)
    or (p_command in ('note','return') and (clean_note is null or length(clean_note) not between 1 and 4000)) then
    raise exception 'Invalid command arguments' using errcode='22023';
  end if;
  payload:=jsonb_build_object('order_id',p_order_id,'expected_version',p_expected_version,
    'command',p_command,'assignee_id',p_assignee_id,'note',clean_note);
  -- Serializes retries of the same actor/request even across different orders.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text||':'||p_request_id::text,0));
  select * into w from public.work_orders where id=p_order_id for update;
  if not found or not private.can_access_jobsite(w.jobsite_id)
    or not exists(select 1 from public.jobsites where id=w.jobsite_id and is_active) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select * into prior from public.work_order_events where actor_id=actor.id and request_id=p_request_id;
  if found then
    if prior.request_payload<>payload then raise exception 'Request ID reused with different command' using errcode='22023'; end if;
    return jsonb_build_object('event_no',prior.event_no,'order',prior.result_snapshot,'replayed',true);
  end if;
  if w.version<>p_expected_version then raise exception 'Work order version conflict' using errcode='40001'; end if;
  if w.status='completed' then raise exception 'Work order already completed' using errcode='22023'; end if;
  next_status:=w.status;
  if p_command='assign' then
    if actor.role<>'admin' or w.status not in ('waiting','in_progress') then
      raise exception 'Assignment not permitted' using errcode='42501';
    end if;
    select * into target from public.profiles where id=p_assignee_id and is_active;
    if not found or target.role not in ('admin','engineer') or
      (target.role<>'admin' and not exists(select 1 from public.user_jobsites where user_id=target.id and jobsite_id=w.jobsite_id)) then
      raise exception 'Assignee not eligible' using errcode='22023';
    end if;
  else
    if actor.role<>'admin' and actor.id is distinct from w.assignee_id then
      raise exception 'Only assigned engineer may operate' using errcode='42501';
    end if;
    if p_command<>'note' and w.assignee_id is null then raise exception 'Assignment required' using errcode='22023'; end if;
    if p_command in ('approve','return') and actor.role<>'admin' then raise exception 'Admin review required' using errcode='42501'; end if;
    case p_command
      when 'start' then
        if w.status<>'waiting' then raise exception 'Invalid transition' using errcode='22023'; end if;
        next_status:='in_progress';
      when 'submit' then
        if w.status<>'in_progress' then raise exception 'Invalid transition' using errcode='22023'; end if;
        next_status:='review';
      when 'approve' then
        if w.status<>'review' then raise exception 'Invalid transition' using errcode='22023'; end if;
        next_status:='completed';
      when 'return' then
        if w.status<>'review' then raise exception 'Invalid transition' using errcode='22023'; end if;
        next_status:='in_progress';
      else null;
    end case;
  end if;
  update public.work_orders set
    status=next_status, version=version+1,
    assignee_id=case when p_command='assign' then target.id else assignee_id end,
    assignee=case when p_command='assign' then target.display_name else assignee end,
    assigned_by=case when p_command='assign' then actor.id else assigned_by end,
    assigned_at=case when p_command='assign' then clock_timestamp() else assigned_at end,
    started_at=case when p_command='start' then clock_timestamp() else started_at end,
    completed_at=case when p_command='approve' then clock_timestamp() else completed_at end,
    progress=case when p_command='approve' then 100 else progress end
  where id=w.id returning * into updated;
  insert into public.work_order_events(work_order_id,jobsite_id,actor_id,actor_name,actor_role,
    request_id,command,request_payload,before_status,after_status,assignee_id,note,order_version,result_snapshot)
  values(w.id,w.jobsite_id,actor.id,actor.display_name,actor.role,p_request_id,p_command,payload,
    w.status,updated.status,updated.assignee_id,clean_note,updated.version,to_jsonb(updated))
  returning event_no into event_id;
  return jsonb_build_object('event_no',event_id,'order',to_jsonb(updated),'replayed',false);
end;
$$;
revoke all on function public.apply_work_order_command(text,integer,uuid,text,uuid,text) from public,anon;
grant execute on function public.apply_work_order_command(text,integer,uuid,text,uuid,text) to authenticated;
