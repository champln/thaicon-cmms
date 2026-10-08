# Staging readiness — 2026-09-21

## Verified now (not customer UAT)

- Production project `uqhokxvvqlnxblyeobie` was reported ACTIVE_HEALTHY by the Supabase CLI.
- Read-only catalog query confirms asset columns `building`, `floor`, `room`, `manufacturer`, `model`, `serial_number` (text), and `location_id` (uuid).
- Migration history contains all six expected baseline versions through `202609150002`. This is not a full schema diff.
- `asset_locations` has RLS enabled. SELECT policy uses `private.can_access_jobsite(jobsite_id)`; INSERT policy requires `private.current_user_role()='admin'`.
- Authenticated grants on that catalog are SELECT and INSERT only. The asset foreign key is `(jobsite_id, location_id) → asset_locations(jobsite_id, id) ON DELETE RESTRICT`.
- No Production application data was inserted, updated or deleted. No migration, seed, Edge Function or frontend was deployed.
- `src/admin-supabase.test.ts` adds 11 mock-backed adapter checks: scoped queries, metadata mapping, empty access list, load failures, validation before request, insert-only catalog writes, duplicates/permission rejection, explicit unlink payload and FK-error propagation. Mock rejection is NOT proof the real server rejects the request.

## Blockers / choices

- No project identified as ThaiCon staging in the accessible project inventory. Do not reuse unrelated projects merely because they are accessible.
- Docker CLI exists but its Linux engine connection fails; no local Supabase database tests or backup/restore drill ran.
- No `.env.local` is present in this checkout. The local frontend remains Demo-only. Do not infer that the published site's environment is missing.
- User choice needed: a separately approved hosted project, or a local Docker-backed Supabase environment. Hosted provisioning/billing, real user creation and any access grants require explicit confirmation.

## Setup checklist after target approval

1. Record the approved project reference/URL and ownership. Verify it is NOT `uqhokxvvqlnxblyeobie` before any synthetic-data writes or database resets. Use a separate working directory/configuration so Production is not accidentally relinked.
2. Install the same six migrations on that empty test target. Use only synthetic data; do not copy customer records or Auth credentials.
3. Deploy both Edge Functions using test-project secrets. Never put server credentials in frontend variables or Git.
4. Create isolated Admin, Engineer-A, User-A and disabled test identities, plus SITE-A/SITE-B. Obtain approval for provisioning and site assignments. Do not reuse public Demo passwords for real Auth accounts.
5. Configure the local frontend with only that target's URL and publishable key in an ignored environment file. Keep GitHub Pages Production variables unchanged.
6. Test via normal authenticated clients, not service_role. A service-role connection bypassing RLS cannot certify user permissions.

## Integration acceptance matrix (all NOT RUN)

| Identity / case | Expected |
| --- | --- |
| Admin create location and asset metadata | Save, reload and second session return identical values |
| Admin duplicate location path | Rejected without duplicate rows; form retains user input |
| Asset assigned to other-site location | Database rejects even when bypassing frontend filtering |
| Engineer-A / User-A read catalog | SITE-A records only; SITE-B data inaccessible |
| Engineer-A / User-A insert location or change asset | Denied by database policy |
| Anonymous / disabled identity | No protected catalog/asset access |
| Catalog update/delete by normal authenticated client | Denied; current catalog is immutable |
| Unlink location_id and save manual metadata | Explicit null persisted; other metadata retained |
| Network/permission failure | No success notification or false saved state; retry possible |
| History | Only the selected asset/site's stored reports, repair requests and orders |

Record date, app commit/working-tree revision, project, test identity, request/result and cleanup outcome without recording passwords, bearer tokens or signed URLs. Preserve earlier UAT baselines.

## Backup / restore preparation (NOT EXECUTED)

- First exercise backup and restore using synthetic staging data into a second isolated test destination.
- Track schema, application data, Auth dependencies, Storage object bytes/metadata, configuration and Edge Function deployment separately. A PostgreSQL dump alone is not a complete Supabase application backup.
- Store artifacts outside Git with restricted access and approved retention. Record checksums and timestamps; do not upload backups to another service without approval.
- Restore must preserve schema/constraints/policies, row counts and representative records; verify login, site isolation and private attachment retrieval in the restored environment.
- Obtain explicit approval before exporting real Production data or replacing any destination. Never test restore over Production or use a destructive reset on the linked Production project.
