# Backend Foundation

This repository includes Supabase migrations for authentication, Jobsite access, and the confirmed annual-plan-to-Service-Report workflow. The frontend has a Supabase Auth adapter and falls back to source-controlled demo accounts when environment values are not supplied.

## Included schema

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
7. Load `supabase/seed.sql` into Development only.
8. Deploy `supabase/functions/admin-users` with the Supabase CLI. The function uses the server-side `SUPABASE_SERVICE_ROLE_KEY`; never expose that value through a `VITE_` variable.
9. Create the first user through Supabase Auth, promote its profile to `admin`, then use the Admin function for later accounts and Jobsite assignments.
10. Run `npm run test:db` and verify the access scenarios below before connecting the frontend.

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

- authenticates with Supabase email/password Auth;
- restores the persisted Supabase session;
- loads the signed-in user's `profiles` row;
- loads only Jobsites allowed by RLS;
- loads and synchronizes plans, Service Reports, attachments, and repair requests for allowed Jobsites;
- loads and synchronizes Work Orders and Alarms for allowed Jobsites;
- loads Admin Center master data from Supabase and performs Jobsite/Asset CRUD online;
- creates, updates, disables, and deletes Auth accounts through the `admin-users` Edge Function;
- uploads Service Report images to the private Storage bucket and uses signed URLs for viewing;
- signs out through Supabase Auth;
- hides the source-controlled demo account shortcuts.

`src/admin-supabase.ts` contains the browser-safe adapter for Jobsite/Asset CRUD and invokes the `admin-users` Edge Function for Auth account administration. Auth account creation and password changes must go through the Edge Function so the service-role key remains server-side.

The publishable key is designed for browser use and remains constrained by RLS. Never expose a `service_role` or secret key through a `VITE_` variable.

## Production activation

Create the Development Supabase project, apply all four migrations, deploy `admin-users`, create the first Auth admin, assign Jobsite access, and configure the two `VITE_SUPABASE_*` values. Follow `docs/production-activation-checklist.md` and complete an RLS integration pass before enabling Production.

