create function public.is_cmms_backup_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.full_backup_operators o
    join public.profiles p on p.id = o.user_id
    where o.user_id = auth.uid() and p.role = 'admin' and p.is_active
  )
$$;

revoke all on function public.is_cmms_backup_operator() from public, anon, authenticated;
grant execute on function public.is_cmms_backup_operator() to authenticated;

-- Preserve the existing write and delete predicates verbatim. The dedicated
-- backup operator can read every bucket, including files from inactive sites.
do $$
declare
  rule record;
begin
  select qual, with_check into strict rule
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'service files require active role and site';

  drop policy "service files require active role and site" on storage.objects;
  execute format(
    'create policy "service files require active site for reads" on storage.objects as restrictive for select to authenticated using ((%s) or (select public.is_cmms_backup_operator()))',
    rule.qual
  );
  execute format(
    'create policy "service files require active site for inserts" on storage.objects as restrictive for insert to authenticated with check (%s)',
    rule.with_check
  );
  execute format(
    'create policy "service files require active site for updates" on storage.objects as restrictive for update to authenticated using (%s) with check (%s)',
    rule.qual, rule.with_check
  );
  execute format(
    'create policy "service files require active site for deletes" on storage.objects as restrictive for delete to authenticated using (%s)',
    rule.qual
  );
end;
$$;

create policy "backup operator can read archived objects" on storage.objects
for select to authenticated using ((select public.is_cmms_backup_operator()));
