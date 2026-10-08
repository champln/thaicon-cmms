-- Read-only command-mode snapshots. Gates remain unchanged/default OFF.
-- STABLE RPC reads related rows and deletion evidence in one SQL snapshot.
create function public.live_snapshot_access(p_site_id text,p_kind text)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if private.current_user_role() is null or not private.can_access_jobsite(p_site_id)
   or not exists(select 1 from public.jobsites where id=p_site_id and is_active) then
   raise exception 'Live snapshot scope denied' using errcode='42501';
 end if;
 if p_kind='maintenance' then
   return private.plan_commands_enabled() and private.service_report_drafts_enabled()
     and private.service_report_reviews_enabled() and private.repair_commands_enabled();
 elsif p_kind='alarms' then return private.alarm_commands_enabled();
 else raise exception 'Unknown live snapshot kind' using errcode='22023'; end if;
end;$$;
revoke all on function public.live_snapshot_access(text,text) from public,anon;
grant execute on function public.live_snapshot_access(text,text) to authenticated;

create function public.live_snapshot_context(p_site_id text,p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare enabled boolean;
begin
 enabled:=public.live_snapshot_access(p_site_id,p_kind);
 return jsonb_build_object('protocol',1,'site_id',p_site_id,'kind',p_kind,
   'actor_id',auth.uid(),'actor_role',private.current_user_role(),'enabled',enabled);
end;$$;
revoke all on function public.live_snapshot_context(text,text) from public,anon;
grant execute on function public.live_snapshot_context(text,text) to authenticated;

create function public.read_live_snapshot(p_site_id text,p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.live_snapshot_access(p_site_id,p_kind) then
   raise exception 'Live snapshot command gates disabled' using errcode='42501';
 end if;
 result:=public.live_snapshot_context(p_site_id,p_kind);
 if p_kind='maintenance' then
   result:=result||jsonb_build_object(
     'plans',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.maintenance_plans p where p.jobsite_id=p_site_id),'[]'::jsonb),
     'cycles',coalesce((select jsonb_agg(to_jsonb(c) order by c.plan_id,c.sequence,c.id) from public.plan_cycles c join public.maintenance_plans p on p.id=c.plan_id where p.jobsite_id=p_site_id),'[]'::jsonb),
     'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.service_reports r where r.jobsite_id=p_site_id),'[]'::jsonb),
     'attachments',coalesce((select jsonb_agg(to_jsonb(a) order by a.service_report_id,a.id) from public.service_report_attachments a join public.service_reports r on r.id=a.service_report_id where r.jobsite_id=p_site_id),'[]'::jsonb),
     'repairs',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.repair_requests r where r.jobsite_id=p_site_id),'[]'::jsonb),
     'plan_tombstones',coalesce((select jsonb_agg(jsonb_build_object('id',e.plan_id,'site_id',e.jobsite_id,'version',e.plan_version) order by e.plan_id)
       from public.plan_events e where e.jobsite_id=p_site_id and e.command='delete'),'[]'::jsonb)
   );
 else
   result:=result||jsonb_build_object('alarms',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.alarms a where a.jobsite_id=p_site_id),'[]'::jsonb));
 end if;
 -- Fail visibly, never return a truncated list. Large sites need a consistent
 -- versioned cursor design before rollout of this bounded read endpoint.
 if pg_catalog.octet_length(result::text)>8388608 then
   raise exception 'Live snapshot exceeds 8 MiB' using errcode='54000';
 end if;
 return result;
end;$$;
revoke all on function public.read_live_snapshot(text,text) from public,anon;
grant execute on function public.read_live_snapshot(text,text) to authenticated;

-- Preserve existing publication members; no global child/DELETE streams.
do $$declare target text;
begin
 if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
 if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime' and puballtables) then return; end if;
 foreach target in array array['maintenance_plans','plan_events','service_reports','service_report_events','repair_requests','repair_events','alarms','alarm_events'] loop
   if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=target) then
     execute format('alter publication supabase_realtime add table public.%I',target);
   end if;
 end loop;
end;$$;
