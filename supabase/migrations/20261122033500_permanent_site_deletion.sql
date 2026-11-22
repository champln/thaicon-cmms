begin;

create table private.site_deletion_backups (
  id uuid primary key default gen_random_uuid(),
  jobsite_id text not null,
  actor_id uuid not null,
  site_row jsonb not null,
  payload jsonb not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
alter table private.site_deletion_backups enable row level security;
revoke all on private.site_deletion_backups from public, anon, authenticated;

create function private.site_deletion_lock(p_site text)
returns public.jobsites language plpgsql security definer set search_path = '' as $$
declare
  site public.jobsites;
begin
  -- Hold the role and site state constant through the transaction.
  perform 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active for share nowait;
  if not found then raise exception 'Site deletion requires an active Admin' using errcode = '42501'; end if;
  select * into site from public.jobsites where id = p_site for update nowait;
  return site;
end;
$$;

create function private.assert_site_deletion_eligible(p_site public.jobsites)
returns void language plpgsql security definer set search_path = '' as $$
declare
  scope record;
  has_rows boolean;
begin
  if p_site.id is null then raise exception 'Site not found' using errcode = 'P0002'; end if;
  if p_site.is_active then raise exception 'Close the site before deletion' using errcode = 'TS001'; end if;

  -- Check current foreign keys (including CASCADE) and site-scoped tables
  -- without a foreign key. Only audit and backup history may outlive a site.
  for scope in
    select distinct c.oid::regclass as relation, a.attname as column_name, false as is_receipt
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r','p') and not c.relispartition
      and c.oid not in ('private.site_audit_log'::regclass,'private.site_backup_runs'::regclass,
        'private.site_deletion_backups'::regclass)
      and ((n.nspname in ('public','private') and a.attname in ('jobsite_id','site_id')) or exists (
        select 1 from pg_constraint f
        where f.conrelid = c.oid and f.contype = 'f' and f.confrelid = 'public.jobsites'::regclass
          and a.attnum = any(f.conkey)
      ))
    union all
    select 'private.contract_definition_receipts'::regclass, 'payload'::name, true
    order by relation, column_name
  loop
    -- Also serialize against writes to references which lack FK protection.
    execute format('lock table %s in share mode nowait', scope.relation);
    if scope.is_receipt then
      execute format('select exists (select 1 from %s where payload->>''site'' = $1)', scope.relation)
        into has_rows using p_site.id;
    else
      execute format('select exists (select 1 from %s where %I = $1)', scope.relation, scope.column_name)
        into has_rows using p_site.id;
    end if;
    if has_rows then raise exception 'Site still has references' using errcode = 'TS002'; end if;
  end loop;
  lock table storage.objects in share mode nowait;
  if exists (select 1 from storage.objects where split_part(name, '/', 1) = p_site.id) then
    raise exception 'Site still has Storage objects' using errcode = 'TS002';
  end if;
end;
$$;

create function public.prepare_site_deletion(p_site text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  site public.jobsites := private.site_deletion_lock(p_site);
  archived jsonb;
  backup_id uuid;
begin
  perform private.assert_site_deletion_eligible(site);
  select jsonb_build_object('format','thaicon-site-deletion-backup-v1','site',to_jsonb(site),
    'audit',coalesce(jsonb_agg(to_jsonb(e) order by event_id),'[]'::jsonb))
    into archived from private.site_audit_log e where e.jobsite_id = p_site;
  insert into private.site_deletion_backups (jobsite_id, actor_id, site_row, payload, sha256)
    values (p_site, auth.uid(), to_jsonb(site), archived, encode(sha256(convert_to(archived::text,'UTF8')),'hex'))
    returning id into backup_id;
  insert into private.site_audit_log (jobsite_id,actor_id,actor_name,action,entity,record_id)
    select p_site, id, display_name, 'deletion_backup_saved', 'site_deletion_backups', backup_id::text
    from public.profiles where id = auth.uid();
  return backup_id;
end;
$$;

create function public.delete_closed_site(p_site text, p_backup uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  site public.jobsites := private.site_deletion_lock(p_site);
  backup private.site_deletion_backups;
begin
  select * into backup from private.site_deletion_backups
    where id = p_backup and jobsite_id = p_site and actor_id = auth.uid() for update;
  if found and backup.deleted_at is not null and site.id is null then return true; end if;
  perform private.assert_site_deletion_eligible(site);
  if backup.id is null or backup.deleted_at is not null
    or backup.created_at < clock_timestamp() - interval '15 minutes'
    or backup.site_row is distinct from to_jsonb(site)
    or backup.sha256 is distinct from encode(sha256(convert_to(backup.payload::text,'UTF8')),'hex') then
    raise exception 'A current server backup is required' using errcode = 'TS003';
  end if;
  delete from public.jobsites where id = p_site and not is_active;
  update private.site_deletion_backups set deleted_at = clock_timestamp() where id = backup.id;
  -- The site-row trigger retains the site-scoped event. Also expose the
  -- deletion in the system-wide log, including the backup ID for export.
  insert into private.site_audit_log (actor_id,actor_name,action,entity,record_id)
    select id, display_name, 'site_permanently_deleted', p_site, backup.id::text
    from public.profiles where id = auth.uid();
  return true;
end;
$$;

create function public.read_site_deletion_backup(p_backup uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  perform private.require_site_backup_admin(null);
  select jsonb_build_object('id',id,'created_at',created_at,'sha256',sha256,'backup',payload)
    into result from private.site_deletion_backups where id = p_backup;
  if not found then raise exception 'Backup not found' using errcode = 'P0002'; end if;
  return result;
end;
$$;

revoke all on function private.site_deletion_lock(text), private.assert_site_deletion_eligible(public.jobsites)
  from public, anon, authenticated;
revoke all on function public.prepare_site_deletion(text), public.delete_closed_site(text,uuid), public.read_site_deletion_backup(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_site_deletion(text), public.delete_closed_site(text,uuid), public.read_site_deletion_backup(uuid)
  to authenticated;
commit;
