-- Re-check active role and current site access on every file operation, including
-- an existing owner's update/delete after access revocation. No object is moved.
create policy "service files require active role and site"
on storage.objects as restrictive for all to authenticated
using (
  bucket_id <> 'service-report-photos'
  or (
    private.current_user_role() is not null
    and private.can_access_jobsite((storage.foldername(name))[1])
    and exists(select 1 from public.jobsites where id=(storage.foldername(storage.objects.name))[1] and is_active)
  )
)
with check (
  bucket_id <> 'service-report-photos'
  or (
    private.current_user_role() in ('admin','engineer')
    and private.can_access_jobsite((storage.foldername(name))[1])
    and exists(select 1 from public.jobsites where id=(storage.foldername(storage.objects.name))[1] and is_active)
  )
);
