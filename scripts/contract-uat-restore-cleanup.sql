-- Run on the disposable destination only, after restoring the file bytes.
do $$
declare
  rule record;
begin
  for rule in select * from private.uat_restore_policy_originals loop
    execute format('alter policy %I on storage.objects with check (%s)', rule.policyname, rule.with_check);
  end loop;
end;
$$;

drop policy uat_restore_file_insert on storage.objects;
drop function public.uat_restore_stage(text,integer,text);
drop function public.uat_restore_apply(text,integer,uuid);
drop function public.uat_restore_file_allowed(text,text);
drop table private.uat_restore_chunks, private.uat_restore_files, private.uat_restore_policy_originals;
