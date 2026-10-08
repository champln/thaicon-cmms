-- Pending review foundation only: NOT a transactional report/Storage save API.
-- Keep OFF until the frontend explicitly uses these commands and confirms saves.
create table private.service_report_settings (
  singleton boolean primary key default true check(singleton),
  reviews_enabled boolean not null default false
);
insert into private.service_report_settings values(true,false);
revoke all on private.service_report_settings from public,anon,authenticated;
create function private.service_report_reviews_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select reviews_enabled from private.service_report_settings where singleton),false);
$$;
revoke all on function private.service_report_reviews_enabled() from public,anon;
grant execute on function private.service_report_reviews_enabled() to authenticated;
alter table public.service_reports add column version integer not null default 1 check(version>0);

create table public.service_report_events (
  event_no bigint generated always as identity primary key,
  service_report_id text not null references public.service_reports(id) on delete restrict,
  jobsite_id text not null references public.jobsites(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  actor_name text not null,
  actor_role public.app_role not null,
  request_id uuid not null,
  command text not null check(command in ('submit','approve','return')),
  request_payload jsonb not null,
  before_status public.service_report_status not null,
  after_status public.service_report_status not null,
  report_version integer not null check(report_version>1),
  note text,
  recorded_at timestamptz not null default clock_timestamp(),
  result_snapshot jsonb not null,
  unique(actor_id,request_id),
  unique(service_report_id,report_version)
);
create index service_report_events_history_idx on public.service_report_events(service_report_id,event_no);
alter table public.service_report_events enable row level security;
revoke all on public.service_report_events from public,anon,authenticated;
grant select on public.service_report_events to authenticated;
create policy service_report_events_read on public.service_report_events for select to authenticated
using(private.can_access_jobsite(jobsite_id) and exists(select 1 from public.jobsites s where s.id=jobsite_id and s.is_active));

create function private.guard_service_report_review_write() returns trigger
language plpgsql set search_path='' as $$
declare owner_write boolean;
begin
  select current_user=pg_catalog.pg_get_userbyid(c.relowner) into owner_write
    from pg_catalog.pg_class c where c.oid='public.service_reports'::regclass;
  if owner_write then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if private.service_report_reviews_enabled() then
    if tg_op='INSERT' then
      if new.status<>'draft' then raise exception 'Create a draft before review' using errcode='42501'; end if;
    elsif old.status in ('submitted','approved') or (tg_op='UPDATE' and new.status<>old.status) then
      raise exception 'Use service report review command; reviewed evidence is locked' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='INSERT' then
    if new.version<>1 then raise exception 'Server-managed report version' using errcode='42501'; end if;
  else
    if new.version<>old.version then raise exception 'Server-managed report version' using errcode='42501'; end if;
    new.version:=old.version+1;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_service_report_review_write() from public,anon,authenticated;
create trigger service_reports_command_guard before insert or update or delete on public.service_reports
for each row execute function private.guard_service_report_review_write();

-- Metadata changes serialize on the same report row as review. Existing owner
-- privileges do not bypass an approved/submitted report lock for app identities.
create function private.guard_reviewed_report_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
declare report_id text; r public.service_reports%rowtype;
begin
  if not private.service_report_reviews_enabled() then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='UPDATE' and new.service_report_id<>old.service_report_id then
    raise exception 'Cannot move report evidence' using errcode='42501';
  end if;
  report_id:=case when tg_op='DELETE' then old.service_report_id else new.service_report_id end;
  select * into r from public.service_reports where id=report_id for update;
  if not found or r.status not in ('draft','rejected') or not private.can_access_jobsite(r.jobsite_id)
    or private.current_user_role() is null or private.current_user_role() not in ('admin','engineer')
    or not exists(select 1 from public.jobsites where id=r.jobsite_id and is_active)
    or (private.current_user_role()='engineer' and r.created_by<>auth.uid()) then
    raise exception 'Report evidence is not editable' using errcode='42501';
  end if;
  -- Invalidate any prepared review version when photo metadata changes.
  update public.service_reports set version=version+1 where id=r.id;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function private.guard_reviewed_report_attachment() from public,anon,authenticated;
create trigger service_report_attachments_review_guard before insert or update or delete on public.service_report_attachments
for each row execute function private.guard_reviewed_report_attachment();

create function public.service_report_reviews_ready() returns boolean
language sql stable security definer set search_path='' as $$
  select private.service_report_reviews_enabled() and private.current_user_role() is not null;
$$;
revoke all on function public.service_report_reviews_ready() from public,anon;
grant execute on function public.service_report_reviews_ready() to authenticated;

create function public.apply_service_report_review(
  p_report_id text,p_expected_version integer,p_request_id uuid,p_command text,p_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; r public.service_reports%rowtype;
  updated public.service_reports%rowtype; prior public.service_report_events%rowtype;
  payload jsonb; next_status public.service_report_status; event_id bigint;
  reason text:=btrim(p_reason);
begin
  if not private.service_report_reviews_enabled() then raise exception 'Report reviews not enabled' using errcode='42501'; end if;
  select * into actor from public.profiles where id=auth.uid() and is_active;
  if not found or actor.role not in ('admin','engineer') then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_request_id is null or p_expected_version is null or p_expected_version<1 or p_command is null
    or p_command not in ('submit','approve','return')
    or (p_command='return' and (reason is null or length(reason) not between 1 and 4000))
    or (p_command<>'return' and p_reason is not null) then
    raise exception 'Invalid review arguments' using errcode='22023';
  end if;
  payload:=jsonb_build_object('report_id',p_report_id,'expected_version',p_expected_version,'command',p_command,'reason',reason);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.id::text||':'||p_request_id::text,0));
  select * into r from public.service_reports where id=p_report_id for update;
  if not found or not private.can_access_jobsite(r.jobsite_id)
    or not exists(select 1 from public.jobsites where id=r.jobsite_id and is_active)
    or (actor.role='engineer' and r.created_by<>actor.id) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select * into prior from public.service_report_events where actor_id=actor.id and request_id=p_request_id;
  if found then
    if prior.request_payload<>payload then raise exception 'Request ID reused' using errcode='22023'; end if;
    return jsonb_build_object('event_no',prior.event_no,'report',prior.result_snapshot,'replayed',true);
  end if;
  if r.version<>p_expected_version then raise exception 'Service report version conflict' using errcode='40001'; end if;
  if p_command in ('submit','approve') and not exists(select 1 from public.service_report_attachments where service_report_id=r.id) then
    raise exception 'At least one report photo required' using errcode='22023';
  end if;
  -- Do not freeze a known broken proof pointer. This verifies Storage catalog
  -- presence and metadata scope, NOT byte-level fetchability or full atomicity.
  if p_command in ('submit','approve') and exists (
    select 1 from public.service_report_attachments a where a.service_report_id=r.id
      and ((storage.foldername(a.storage_path))[1] is distinct from r.jobsite_id
        or (storage.foldername(a.storage_path))[2] is distinct from r.id
        or a.content_type not in ('image/jpeg','image/png','image/webp')
        or not exists(select 1 from storage.objects o where o.bucket_id='service-report-photos' and o.name=a.storage_path))
  ) then raise exception 'Report attachment missing or out of scope' using errcode='22023'; end if;
  if p_command='submit' then
    if r.status not in ('draft','rejected') then raise exception 'Invalid report transition' using errcode='22023'; end if;
    if btrim(r.technician_name)='' or btrim(r.customer_name)='' or btrim(r.work_performed)='' then
      raise exception 'Incomplete service report' using errcode='22023';
    end if;
    next_status:='submitted';
  else
    if actor.role<>'admin' then raise exception 'Admin review required' using errcode='42501'; end if;
    if r.status<>'submitted' then raise exception 'Invalid report transition' using errcode='22023'; end if;
    next_status:=case when p_command='approve' then 'approved'::public.service_report_status else 'rejected'::public.service_report_status end;
  end if;
  update public.service_reports set status=next_status,version=version+1,
    rejection_reason=case when p_command='return' then reason else null end
    where id=r.id returning * into updated;
  insert into public.service_report_events(service_report_id,jobsite_id,actor_id,actor_name,actor_role,
    request_id,command,request_payload,before_status,after_status,report_version,note,result_snapshot)
  values(r.id,r.jobsite_id,actor.id,actor.display_name,actor.role,p_request_id,p_command,payload,
    r.status,updated.status,updated.version,reason,to_jsonb(updated)) returning event_no into event_id;
  return jsonb_build_object('event_no',event_id,'report',to_jsonb(updated),'replayed',false);
end;
$$;
revoke all on function public.apply_service_report_review(text,integer,uuid,text,text) from public,anon;
grant execute on function public.apply_service_report_review(text,integer,uuid,text,text) to authenticated;

-- Freeze original photo objects too, not just attachment metadata. Storage bytes
-- are a separate service transaction; this is not a full upload atomicity claim.
create function private.service_report_file_editable(object_name text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare r public.service_reports%rowtype; actor public.profiles%rowtype;
begin
  if not private.service_report_reviews_enabled() then return true; end if;
  select * into actor from public.profiles where id=auth.uid() and is_active;
  if not found or actor.role not in ('admin','engineer') then return false; end if;
  select * into r from public.service_reports
    where id=(storage.foldername(object_name))[2] and jobsite_id=(storage.foldername(object_name))[1]
    for update;
  return found and r.status in ('draft','rejected') and private.can_access_jobsite(r.jobsite_id)
    and exists(select 1 from public.jobsites where id=r.jobsite_id and is_active)
    and (actor.role='admin' or r.created_by=actor.id);
end;
$$;
revoke all on function private.service_report_file_editable(text) from public,anon;
grant execute on function private.service_report_file_editable(text) to authenticated;
create policy service_report_review_file_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'service-report-photos' or private.service_report_file_editable(name));
create policy service_report_review_file_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'service-report-photos' or private.service_report_file_editable(name))
with check(bucket_id<>'service-report-photos' or private.service_report_file_editable(name));
create policy service_report_review_file_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'service-report-photos' or private.service_report_file_editable(name));
