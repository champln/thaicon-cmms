# Backend Foundation

This repository now includes the first Supabase migration for authentication profiles and Jobsite access. It does not yet connect the public frontend to Supabase; the current Login remains an explicitly labeled demo adapter until a project and environment values are supplied.

## Included schema

- `profiles`: application username, role, title, and active status linked to `auth.users`
- `jobsites`: Jobsite master data
- `user_jobsites`: many-to-many user access assignments
- `app_role`: `admin`, `engineer`, and `user`
- Row Level Security policies for all three public tables
- Private helper functions used by RLS
- A trigger that creates a safe default `user` profile for new Auth accounts

Workflow tables such as plans, work orders, Service Reports, and repair requests are intentionally deferred until the customer confirms the full start-to-finish workflow.

## Apply to a Supabase project

1. Create separate Development and Production Supabase projects.
2. Authenticate the Supabase CLI and link the local repository to the Development project.
3. Apply `supabase/migrations/202608190001_access_foundation.sql`.
4. Load `supabase/seed.sql` into Development only.
5. Create users through Supabase Auth so passwords are handled by Auth and never committed to source.
6. Promote the required profile to `admin`, then create rows in `user_jobsites`.
7. Verify the access scenarios below before connecting the frontend.

## Required RLS checks

- Anonymous requests cannot read any profile, Jobsite, or assignment.
- Admin can read and manage every Jobsite and assignment.
- Engineer can read only assigned Jobsites.
- User can read only assigned Jobsites.
- Engineer/User cannot assign themselves to another Jobsite.
- Disabled profiles cannot gain Jobsite access.
- Browser code never receives a Supabase service-role key.

## Next integration batch

The next backend batch will add a Supabase client adapter behind the existing Login and Jobsite selector. It requires the Development project URL and publishable/anonymous key. Production credentials must remain in deployment secrets and local `.env` files, not in Git.

