# AGENTS.md

## Project overview

ThaiCon CMMS is a React and TypeScript maintenance-management application. It currently supports a demo workflow and is being migrated toward a production Supabase backend.

The application covers:

- maintenance dashboards;
- jobsite-scoped access;
- work orders and alarms;
- preventive-maintenance plans;
- asset and customer-site records;
- IoT monitoring and telemetry;
- Supabase authentication, profiles, and role-based access.

Treat the current application as a working prototype. Authentication and jobsite access have a Supabase foundation, while much of the operational CMMS and IoT data is still mocked.

## Technology

- React 19
- TypeScript 5.9
- Vite 8
- Vitest
- Supabase JavaScript client
- Supabase PostgreSQL migrations and Row Level Security
- GitHub Pages deployment through GitHub Actions
- Node.js 22.13 or newer

## Repository map

- `src/App.tsx`: authentication and application entry flow.
- `src/CMMSApp.tsx`: main CMMS interface and workflows.
- `src/IoTMonitor.tsx`: IoT monitoring interface.
- `src/access.ts`: demo users, roles, and jobsite-scoped access rules.
- `src/supabase.ts`: Supabase client configuration.
- `src/supabase-auth.ts`: Supabase authentication adapter and data mapping.
- `src/*.test.ts`: access and authentication tests.
- `supabase/migrations/`: database schema and RLS migrations.
- `supabase/seed.sql`: development-only seed data.
- `docs/backend-foundation.md`: backend setup and security guidance.
- `.github/workflows/deploy-pages.yml`: validation and GitHub Pages deployment.

## Working principles

1. Read `README.md` and `docs/backend-foundation.md` before changing authentication, authorization, database access, or deployment.
2. Inspect the relevant implementation and tests before editing. Do not infer behavior from filenames alone.
3. Make the smallest cohesive change that solves the requested problem.
4. Preserve existing behavior unless the task explicitly changes it.
5. Keep business rules separate from presentation code when practical.
6. Prefer typed functions and explicit domain models. Do not introduce `any` unless an external boundary makes it unavoidable and the reason is documented.
7. Add or update tests when changing access rules, authentication, data mapping, or workflow behavior.
8. Do not perform unrelated refactors while fixing a focused issue.
9. Never commit, push, open a pull request, merge, deploy, or modify remote GitHub state without explicit user authorization for that action.

## Collaboration between agents

- Before editing, state the files and behavior being handled.
- If multiple agents work concurrently, divide work by non-overlapping files or clearly bounded concerns.
- Do not overwrite or revert another agent's changes. Re-read shared files immediately before applying an edit.
- Record assumptions, discovered constraints, and unfinished work in the handoff.
- Report exact validation commands and their results.
- Escalate conflicting requirements instead of silently choosing one.
- Keep commits focused on one concern when commit authorization is provided.

## Product and domain rules

- Every operational record must be scoped to a jobsite unless a documented global use case requires otherwise.
- Supported application roles are `admin`, `engineer`, and `user`.
- Client-side filtering is a user-interface convenience, not a security boundary. Production authorization must be enforced by Supabase RLS.
- Demo accounts and mock data are for development and interface verification only.
- Clearly label mock, simulated, or placeholder IoT data in code and UI.
- Do not invent a final work-order or service-report workflow. Confirm the end-to-end business process before adding permanent workflow tables or irreversible schema decisions.
- Preserve Thai-language usability and responsive behavior on desktop and mobile.

## Supabase and security

- Never expose or commit a Supabase `service_role` key, secret key, password, token, or populated environment file.
- Browser code may use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Keep `.env.local` and all real credentials out of version control.
- Create database changes as forward migrations under `supabase/migrations/`.
- Do not edit a migration that may already have been applied; add a new migration instead.
- Enable and test RLS for every client-accessible table.
- Anonymous users must not read profiles, jobsites, assignments, or CMMS operational data.
- Engineers and users must access only assigned jobsites.
- Non-admin users must not grant themselves additional access.
- Disabled profiles must not regain access through assignments or client-side state.
- Seed data belongs in development environments only.

## Implementation guidance

- Prefer extracting focused components, hooks, services, and domain utilities instead of increasing the size of `CMMSApp.tsx` or `IoTMonitor.tsx`.
- Keep Supabase queries and response mapping outside large presentational components.
- Represent loading, empty, error, and unauthorized states explicitly.
- Preserve the demo fallback when Supabase environment variables are absent unless the task explicitly removes it.
- When Supabase is configured, use persisted sessions and RLS-filtered data rather than duplicating authorization logic in the browser.
- Maintain accessibility: semantic controls, keyboard operation, visible focus states, labels, and adequate contrast.

## Validation

Install dependencies with:

```bash
npm ci
```

Run all required checks before handing off a code change:

```bash
npm run typecheck
npm test
npm run build
```

Also manually verify the affected workflow at desktop and mobile widths when UI behavior changes.

For authentication or authorization changes, verify at minimum:

- no Supabase configuration: demo login still behaves as documented;
- admin: can access all permitted jobsites;
- engineer: can access only assigned jobsites;
- user: can access only assigned jobsites with the intended permissions;
- anonymous and disabled users: cannot access protected data;
- logout: clears the active session and protected UI state.

## Definition of done

A change is complete only when:

- the requested behavior is implemented;
- relevant tests are added or updated;
- typecheck, tests, and production build pass;
- security and jobsite scoping are preserved;
- no credentials or production data are introduced;
- documentation is updated when setup, schema, workflow, or operator behavior changes;
- the handoff lists changed files, validation results, assumptions, and remaining risks.

