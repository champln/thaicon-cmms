create table private.full_backup_operators (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table private.full_backup_operators enable row level security;
revoke all on private.full_backup_operators from public, anon, authenticated;

-- One statement snapshot for app tables, login records and the Storage inventory.
-- Keep sessions, MFA secrets and transient authentication tokens out of the archive.
create function public.capture_cmms_backup()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  relation record;
  rows jsonb;
  tables jsonb := '{}'::jsonb;
  objects jsonb;
  buckets jsonb;
begin
  if not exists (
    select 1 from private.full_backup_operators o
    join public.profiles p on p.id = o.user_id
    where o.user_id = auth.uid() and p.role = 'admin' and p.is_active
  ) then
    raise exception 'Backup operator required' using errcode = '42501';
  end if;

  for relation in
    select n.nspname as schema_name, c.relname as table_name
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r','p')
      and not c.relispartition
      and c.oid <> 'private.full_backup_operators'::regclass
    order by n.nspname, c.relname
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from %I.%I t',
      relation.schema_name, relation.table_name
    ) into rows;
    tables := tables || jsonb_build_object(relation.schema_name || '.' || relation.table_name, rows::text);
  end loop;

  select coalesce(jsonb_agg(to_jsonb(u) - array[
    'confirmation_token', 'recovery_token', 'email_change_token_new',
    'email_change_token_current', 'reauthentication_token', 'phone_change_token',
    'email_change', 'phone_change'
  ] order by u.id), '[]'::jsonb) into rows from auth.users u;
  tables := tables || jsonb_build_object('auth.users', rows::text);
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) into rows from auth.identities i;
  tables := tables || jsonb_build_object('auth.identities', rows::text);

  select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) into buckets from storage.buckets b;
  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket', o.bucket_id, 'path', o.name, 'version', o.version,
    'updatedAt', o.updated_at, 'metadata', o.metadata, 'userMetadata', o.user_metadata
  ) order by o.bucket_id, o.name), '[]'::jsonb) into objects from storage.objects o;

  return jsonb_build_object('tables', tables, 'buckets', buckets, 'objects', objects);
end;
$$;

revoke all on function public.capture_cmms_backup() from public, anon, authenticated;
grant execute on function public.capture_cmms_backup() to authenticated;
