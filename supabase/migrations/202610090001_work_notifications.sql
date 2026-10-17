-- Additive, not deployed: active work reminders, not a durable event inbox.
-- Receipts are private and writable only through identity/scope-checked RPCs.
create table private.work_notification_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  jobsite_id text not null references public.jobsites(id) on delete cascade,
  notification_id text not null,
  read_at timestamptz not null default now(),
  primary key(user_id,jobsite_id,notification_id)
);
alter table private.work_notification_reads enable row level security;
revoke all on private.work_notification_reads from public,anon,authenticated;

create function public.read_work_notifications(p_site_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; actor_role public.app_role;
begin
  actor_role:=private.current_user_role();
  if actor_role is null or actor_role not in ('admin','engineer')
    or not private.can_access_jobsite(p_site_id)
    or not exists(select 1 from public.jobsites where id=p_site_id and is_active) then
    raise exception 'Notification scope denied' using errcode='42501';
  end if;
  with scoped as (
    select w.* from public.work_orders w
    where w.jobsite_id=p_site_id and w.status<>'completed'
      and (actor_role='admin' or w.assignee_id=auth.uid())
  ), candidates as (
    select w.id as order_id,w.title,'assigned'::text kind,
      coalesce(w.assigned_at::text,w.version::text) token
      from scoped w where w.assignee_id=auth.uid()
    union all
    select w.id,w.title,'due-soon',w.due_at::text from scoped w
      where w.due_at>=now() and w.due_at<=now()+interval '24 hours'
    union all
    select w.id,w.title,'overdue',w.due_at::text from scoped w where w.due_at<now()
    union all
    select w.id,w.title,'review',coalesce(
      (select max(e.order_version)::text from public.work_order_events e where e.work_order_id=w.id and e.command='submit'),w.version::text)
      from scoped w where w.status='review' and actor_role='admin'
  ), identified as (
    select *,pg_catalog.md5(jsonb_build_array(order_id,kind,token)::text) notification_id from candidates
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',n.notification_id,'orderId',n.order_id,
    'title',n.title,'kind',n.kind,'read',r.read_at is not null) order by n.kind,n.order_id),'[]'::jsonb)
  into result from identified n left join private.work_notification_reads r
    on r.user_id=auth.uid() and r.jobsite_id=p_site_id and r.notification_id=n.notification_id;
  if pg_catalog.octet_length(result::text)>1048576 then
    raise exception 'Notification result exceeds 1 MiB' using errcode='54000';
  end if;
  return jsonb_build_object('actorId',auth.uid(),'siteId',p_site_id,'items',result);
end; $$;
revoke all on function public.read_work_notifications(text) from public,anon;
grant execute on function public.read_work_notifications(text) to authenticated;

create function public.mark_work_notification_read(p_site_id text,p_notification_id text)
returns void language plpgsql security definer set search_path='' as $$
declare feed jsonb;
begin
  feed:=public.read_work_notifications(p_site_id);
  if not exists(select 1 from jsonb_array_elements(feed->'items') item where item->>'id'=p_notification_id) then
    raise exception 'Notification unavailable' using errcode='42501';
  end if;
  insert into private.work_notification_reads(user_id,jobsite_id,notification_id)
    values(auth.uid(),p_site_id,p_notification_id) on conflict do nothing;
end; $$;
revoke all on function public.mark_work_notification_read(text,text) from public,anon;
grant execute on function public.mark_work_notification_read(text,text) to authenticated;
