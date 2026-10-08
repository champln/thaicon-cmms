# Backend Foundation

## Current local read/realtime contract — 2026-10-06

Migration0014 (21 total /15 unpublished) adds read-only command-mode atomic site snapshots and additive parent/audit publication. Existing gates unchanged/OFF. Maintenance requires all four owning gates ON; Alarm independent. Active actor+actual role+active authorized site checked before read and after photo signing through live context. One SQL snapshot returns actual cycles, full reports/photo metadata/repairs and explicit plan tombstones; no REST max-row truncation, >8MiB fails rather than returning partial output. Large-site versioned cursors still pending. Global child/DELETE subscriptions deliberately absent; trusted owner-only child mutations/deletions are not a certified command invalidation path.

React watchers/monotonic merges are wired, preserve editor drafts and immutable retry operations, and never feed commanded remote data into legacy full-row autosync. Denial is latched through held retry until verified access succeeds; role downgrade with same identity/site also fails closed. User report detail updates to the confirmed version/renewed URLs; staff stale exports blocked with explicit reload while pending review key stays mounted. Actual local JWT/Realtime/Storage + fresh/populated SQL and browser PM regression verified; remaining stress/report/pagination/Production/UAT items are in newest AGENTS.md. Older notes below are historical.

## Latest local integration note — 2026-10-06

Newer Alarm milestone: migration0013 adds independent default-OFF command gate/server versions/immutable acknowledgement audit. Active Admin/Engineer/site checks, exact UUID replay, narrow boolean update, first receiver/time preserved; concurrent requests and audit rollback verified. Current React excludes ALL Alarm data from full-row autosync even OFF, using old-compatible site-qualified boolean PATCH + actual receipt reread when commands unavailable. OFF has no exact-once request ledger; no invented old versions/actor/time. Fresh20/populated-original-six upgrade and real JWT browser ON/OFF/readiness/load-failure regressions PASS. Broad maintenance/Alarm realtime remains unimplemented. Earlier plan/canonical notes below remain applicable; latest AGENTS.md records evidence.

Latest plan milestone adds migration0012/default-OFF `private.plan_settings`, independent of report gates. Active Admin create/save/unreferenced delete uses expected version/exact UUID replay, transactional plan/cycle audit, positive scoped deletion evidence and no ID reuse. Custom stored cycles survive name-only edits; referenced schedule changes/deletion remain prohibited. Scoped definer parent locking preserves Engineer report compatibility and serializes first-report races. Actual cycles feed React; commanded plans/repairs/reports excluded from legacy autosync. Fresh19/populated-original-six upgrade/SQL races/real JWT React regressions PASS. Canonical operations site IDs now preserve same-name/rename scoping in WO/Alarm/history/write/export; ambiguous legacy Demo names fail closed without rewriting originals. Next: narrow confirmed Alarm acknowledgement before broader realtime. No remote migration/deployment authorized.

The following paragraph records the earlier SR-only checkpoint; plan/repair limitations are superseded by the latest note and AGENTS.md.

React PM Service Report forms and reviews use the 0009/0010 command foundations, actual versions, stable retry identities and confirmed reloads. Both gates OFF retain legacy compatibility; both ON select commands; a partial gate configuration raises an error and hides unavailable online maintenance writes/exports. Online initialization is empty and never loads Demo maintenance. Legacy autosync explicitly excludes command-owned reports, attachment metadata and source-linked repairs. Plans/standalone repair writes are still legacy; linked-repair follow-up is temporarily read-only. Memory retry state is not a durable outbox; photo bytes remain separate from atomic SQL metadata. See latest AGENTS.md for test evidence and open TOR work. No remote changes or release made.

This repository includes Supabase migrations for authentication, Jobsite access, and the confirmed annual-plan-to-Service-Report workflow. The frontend has a Supabase Auth adapter and falls back to source-controlled demo accounts when environment values are not supplied.

## Included schema

Local TOR/UAT checkpoint 2026-10-06: six historical deployed migrations plus nine pending forward files (central UAT + `202610060001`–`202610060008`) install/test in isolated environments only. Work Order commands/materials and gate-controlled central UAT are now connected to the UI. Both operator feature gates default false; no remote migration/activation occurred. See the latest `AGENTS.md` checkpoint for real JWT/HTTP/Storage/Realtime/Edge/restore evidence, legacy-client transition and remaining decisions. Do not enable central UAT on Production or run a blanket migration push.

- `profiles`: application username, role, title, and active status linked to `auth.users`
- `jobsites`: Jobsite master data
- `user_jobsites`: many-to-many user access assignments
- `app_role`: `admin`, `engineer`, and `user`
- Row Level Security policies for all three public tables
- Private helper functions used by RLS
- A trigger that creates a safe default `user` profile for new Auth accounts
- `maintenance_plans` and generated `plan_cycles`
- `service_reports` and `service_report_attachments`
- `repair_requests`
- `assets`: asset registry, health, PM dates, and active status by Jobsite
- Asset metadata: building, floor, room, manufacturer, model and serial number
- `asset_locations`: immutable location catalog; authorized-site reads, Admin inserts; composite same-site asset foreign key
- `jobsite_asset_counts`: active asset count view
- `work_orders`: operational Work Orders by Jobsite and asset
- `alarms`: Alarm events and server-controlled acknowledgement audit fields
- `plan_progress` view where Actual counts approved Service Reports only
- Private Storage bucket and policies for Service Report photos
- Approval, scope-validation, updated-at, and plan-cycle triggers

## Apply to a Supabase project

1. Create separate Development and Production Supabase projects.
2. Authenticate the Supabase CLI and link the local repository to the Development project.
3. Apply `supabase/migrations/202608190001_access_foundation.sql`.
4. Apply `supabase/migrations/202608210001_maintenance_workflow.sql`.
5. Apply `supabase/migrations/202608210002_admin_master_data.sql`.
6. Apply `supabase/migrations/202608210003_operations_workflow.sql`.
7. Apply `supabase/migrations/202609150001_asset_metadata.sql` and `202609150002_location_catalog.sql`.
8. Load `supabase/seed.sql` into Development only. Never rerun this example seed on Production.
9. Deploy `supabase/functions/admin-users` and `supabase/functions/username-login`. The former uses the server-side `SUPABASE_SERVICE_ROLE_KEY`; never expose that value through a `VITE_` variable. The pre-login username function uses `verify_jwt=false` as recorded in `supabase/config.toml`.
10. Create the first user through Supabase Auth, promote its profile to `admin`, then use the Admin function for later accounts and Jobsite assignments.
11. Run `npm run test:db` and verify the access scenarios below before connecting the frontend. Existing SQL tests are structural checks, not a full authorization matrix.

For an existing project, inspect migration history/schema first; do not rerun these SQL files or reset Production to resolve already-existing columns.

## Required RLS checks

- Anonymous requests cannot read any profile, Jobsite, or assignment.
- Admin can read and manage every Jobsite and assignment.
- Engineer can read only assigned Jobsites.
- User can read only assigned Jobsites.
- Engineer/User cannot assign themselves to another Jobsite.
- Disabled profiles cannot gain Jobsite access.
- Actual and Progress cannot include Draft, Submitted, or Rejected Service Reports.
- Only Admin can approve or reject a Service Report.
- Engineer can create and edit reports only inside assigned Jobsites.
- User can view plans, reports, repair requests, and download generated documents without editing.
- Authorized users can read assets only in allowed Jobsites; only Admin can change the asset registry.
- Work Orders and Alarms are readable only inside allowed Jobsites.
- Admin/Engineer can operate Work Orders and acknowledge Alarms only inside allowed Jobsites.
- Alarm acknowledgement records the authenticated user and server timestamp.
- Browser code never receives a Supabase service-role key.

## Frontend Auth adapter

The adapter reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. For local development, copy `.env.example` to `.env.local`. For GitHub Pages, configure both names as GitHub repository variables.

When configured, the frontend:

- resolves username login through the `username-login` Edge Function and Supabase Auth; email/password remains supported;
- restores the persisted Supabase session;
- loads the signed-in user's `profiles` row;
- loads only Jobsites allowed by RLS;
- loads and synchronizes plans, Service Reports, attachments, and repair requests for allowed Jobsites;
- loads and synchronizes Work Orders and Alarms for allowed Jobsites;
- loads Admin Center master data from Supabase and performs Jobsite/Asset CRUD online;
- creates, updates, disables, and deletes Auth accounts through the `admin-users` Edge Function;
- uploads Service Report images to the private Storage bucket and uses signed URLs for viewing;
- signs out through Supabase Auth;
- offers isolated Demo accounts without writing their data to Supabase.

`src/admin-supabase.ts` contains the browser-safe adapter for Jobsite/Asset CRUD and invokes the `admin-users` Edge Function for Auth account administration. Auth account creation and password changes must go through the Edge Function so the service-role key remains server-side.

The publishable key is designed for browser use and remains constrained by RLS. Never expose a `service_role` or secret key through a `VITE_` variable.

## Production activation

Create the Development Supabase project, apply all six migrations, deploy both Edge Functions, create the first Auth admin, assign Jobsite access, and configure the two `VITE_SUPABASE_*` values. Follow `docs/production-activation-checklist.md` and complete an RLS integration pass before enabling Production. GitHub Pages deploys only the frontend, not migrations or Edge Functions.

