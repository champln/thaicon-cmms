-- Temporary recovery harness for a fresh, disposable Singapore restore project.
-- Install only on that project with a unique, offline-generated one-time token hash.
create table private.uat_restore_chunks (
  position integer primary key check (position between 0 and 1000),
  contents text not null check (octet_length(contents) <= 300000)
);
create table private.uat_restore_files (
  bucket text not null,
  path text not null,
  primary key (bucket, path)
);
alter table private.uat_restore_chunks enable row level security;
alter table private.uat_restore_files enable row level security;
revoke all on private.uat_restore_chunks, private.uat_restore_files from public, anon, authenticated;

create function public.uat_restore_stage(p_token text, p_position integer, p_contents text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if encode(sha256(convert_to(p_token, 'UTF8')), 'hex') is distinct from '__RESTORE_TOKEN_SHA256__' then
    raise exception 'Restore token required' using errcode = '42501';
  end if;
  insert into private.uat_restore_chunks values (p_position, p_contents)
  on conflict (position) do update set contents = excluded.contents;
end
$$;

create function public.uat_restore_apply(p_token text, p_chunks integer, p_operator uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  payload jsonb;
  bundle jsonb;
  target record;
  relation regclass;
  columns text;
  previous regclass[] := array[]::regclass[];
  restored integer := 0;
  row_data jsonb;
  serial record;
  serial_max bigint;
begin
  if encode(sha256(convert_to(p_token, 'UTF8')), 'hex') is distinct from '__RESTORE_TOKEN_SHA256__' then
    raise exception 'Restore token required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(22300350);
  if exists (select 1 from auth.users) or exists (select 1 from storage.objects)
    or exists (select 1 from public.jobsites) then
    raise exception 'Restore requires a fresh project';
  end if;
  if (select count(*) from private.uat_restore_chunks) <> p_chunks
    or exists (select 1 from generate_series(0, p_chunks - 1) n
      where not exists (select 1 from private.uat_restore_chunks c where c.position = n)) then
    raise exception 'Missing restore chunks';
  end if;
  select convert_from(decode(string_agg(contents, '' order by position), 'base64'), 'UTF8')::jsonb
    into payload from private.uat_restore_chunks;
  bundle := payload->'tables';

  for target in
    select format('%I.%I', n.nspname, c.relname) as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r','p') and not c.relispartition
      and c.relname not in ('uat_restore_chunks','uat_restore_files','uat_restore_policy_originals','full_backup_operators')
  loop
    if not bundle ? target.name then raise exception 'Missing table %', target.name; end if;
    execute format('alter table %s disable trigger user', target.name);
  end loop;

  -- Clear only the catalog and default settings installed by the migrations.
  delete from public.uat_scenarios where true;
  delete from private.uat_settings where true;
  delete from private.work_order_settings where true;
  delete from private.service_report_settings where true;
  delete from private.repair_settings where true;
  delete from private.plan_settings where true;
  delete from private.alarm_settings where true;
  delete from private.contract_reporting_settings where true;

  for target in select key from jsonb_object_keys(bundle) as keys(key)
  loop
    if target.key not in ('auth.users','auth.identities') and
      (target.key !~ '^(public|private)\.[a-z_][a-z0-9_]*$'
      or split_part(target.key,'.',2) in ('uat_restore_chunks','uat_restore_files','uat_restore_policy_originals','full_backup_operators')
      or to_regclass(target.key) is null) then
      raise exception 'Unexpected restore table';
    end if;
  end loop;

  while restored < (select count(*) from jsonb_object_keys(bundle))
  loop
    select key into target from jsonb_object_keys(bundle) as keys(key)
      where not (to_regclass(key) = any(previous))
      and not exists (select 1 from pg_constraint c where c.conrelid = to_regclass(key) and c.contype = 'f'
        and c.confrelid <> c.conrelid and not (c.confrelid::regclass = any(previous)))
      order by key limit 1;
    if not found then raise exception 'Unresolved restore dependencies'; end if;
    relation := to_regclass(target.key);
    select string_agg(quote_ident(attname), ', ' order by attnum) into columns
      from pg_attribute where attrelid = relation and attnum > 0 and not attisdropped and attgenerated = '';
    row_data := (bundle->>target.key)::jsonb;
    if target.key = 'auth.users' then
      select coalesce(jsonb_agg(u || '{"confirmation_token":"","recovery_token":"","email_change_token_new":"","email_change_token_current":"","reauthentication_token":"","phone_change_token":"","email_change":"","phone_change":""}'), '[]'::jsonb)
        into row_data from jsonb_array_elements(row_data) u;
    elsif target.key = 'public.profiles' then
      -- The new project's Auth trigger creates a minimal profile on insert.
      delete from public.profiles where true;
    end if;
    execute format('insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s, $1)',
      relation, columns, columns, relation) using row_data;
    previous := array_append(previous, relation);
    restored := restored + 1;
  end loop;

  for target in select key from jsonb_object_keys(bundle) as keys(key)
    where key like 'public.%' or key like 'private.%'
  loop
    execute format('alter table %s enable trigger user', to_regclass(target.key));
    for serial in select a.attname, pg_get_serial_sequence(target.key, a.attname) as name
      from pg_attribute a where a.attrelid = to_regclass(target.key) and a.attnum > 0 and not a.attisdropped
    loop
      if serial.name is null then continue; end if;
      execute format('select max(%I) from %s', serial.attname, to_regclass(target.key)) into serial_max;
      if serial_max is not null then perform setval(serial.name::regclass, serial_max); end if;
    end loop;
  end loop;

  insert into private.uat_restore_files(bucket, path) select x.bucket, x.path
    from jsonb_to_recordset(payload->'files') as x(bucket text, path text);
  insert into private.full_backup_operators values (p_operator);
  delete from private.uat_restore_chunks where true;
  return restored;
end
$$;

create function public.uat_restore_file_allowed(p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.full_backup_operators where user_id = auth.uid()
  ) and exists (
    select 1 from private.uat_restore_files where bucket = p_bucket and path = p_path
  )
$$;

revoke all on function public.uat_restore_stage(text,integer,text), public.uat_restore_apply(text,integer,uuid),
  public.uat_restore_file_allowed(text,text) from public, anon, authenticated;
grant execute on function public.uat_restore_stage(text,integer,text), public.uat_restore_apply(text,integer,uuid) to anon;
grant execute on function public.uat_restore_file_allowed(text,text) to authenticated;
create policy uat_restore_file_insert on storage.objects for insert to authenticated
  with check (public.uat_restore_file_allowed(bucket_id, name));

-- Both restrictions still apply to every ordinary writer while recovery runs.
create table private.uat_restore_policy_originals as
select policyname, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname in ('service files require active site for inserts', 'service_report_review_file_insert');
alter table private.uat_restore_policy_originals enable row level security;
revoke all on private.uat_restore_policy_originals from public, anon, authenticated;

do $$
declare
  rule record;
begin
  if (select count(*) from private.uat_restore_policy_originals) <> 2 then
    raise exception 'Restore harness requires the current Storage migrations';
  end if;
  for rule in select * from private.uat_restore_policy_originals loop
    execute format(
      'alter policy %I on storage.objects with check ((%s) or public.uat_restore_file_allowed(bucket_id, name))',
      rule.policyname, rule.with_check
    );
  end loop;
end;
$$;
