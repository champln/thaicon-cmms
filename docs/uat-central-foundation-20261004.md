# Central UAT foundation — 2026-10-04

Update 2026-10-06: this document's implementation snapshot below is historical. The working tree now connects gate-controlled central own-run UAT via `CentralUatWorkspace`; real local React/Auth create/save/reload and lost-response same-ID retry passed. Versioned 2026-10-04 results are preserved alongside new 2026-10-06 cases. No archive upload, coordinator UI, private UAT evidence or formal sign-off yet. No online deployment/activation occurred. Use latest `AGENTS.md` for current checklist and exact evidence.

## Scope and current state

Implemented locally: forward migration `202610040001_uat_results.sql`, browser-safe repository `src/uat-supabase.ts`, 12 mocked adapter tests, and executable PostgreSQL RLS checks. **The UAT page still uses browser-local storage.** This adapter is intentionally not wired into the page until isolated UAT configuration and full HTTP/Auth verification are available. No local archives were uploaded. No remote migration, credentials, deployment, commit or push occurred.

The new migration is pending, not one of the six previously applied migrations. Deployment of the frontend does not apply it. Do not run a blanket database push against Production.

## Database contract

- `private.uat_settings`: enabled defaults to false. No public/anon/authenticated access. Only the database operator can enable this after confirming the exact approved UAT project. Frontend Admin is not allowed to enable it.
- `uat_results_ready()` returns false for disabled environments or inactive/missing profiles. Missing RPC/migration is an error, not an empty successful result.
- `uat_scenarios`: immutable versioned role allowlist, 32 IDs for 2026-10-04 (Admin 30 / Engineer 13 / User 9). Future scenario versions require a forward migration and compatibility review of `uat_runs.scenario_version`, adapter mapping and the local archive parser.
- `uat_runs`: immutable UUID, site, owner and tester role from the authenticated session/profile, scenario version, tester name, release, server creation time. Tester name/release are self-reported, not verified signatures.
- `uat_observations`: append-only UUID observations; PASS/FAIL/BLOCKED, actual result, evidence reference text, client time and separate server receipt time/actor; server-generated event number orders history. Evidence remains text only in this phase.
- Browser INSERT grants exclude owner, role, server timestamps and sequence, preventing clients from spoofing those fields. There are no client UPDATE/DELETE grants. Corrections are new observations.
- Active users may create runs only at accessible, active sites. Users read their own results. Active Admin may review results at active sites but cannot append to another tester's run. Role changes prevent appending to a run under the former role.
- Site deactivation, profile disabling, and assignment revocation are reevaluated through RLS. Anonymous users have no table/RPC access.
- Foreign keys use RESTRICT for evidence preservation. Hard-deleting a profile or site referenced by UAT runs will fail; deactivate it. Define a separately approved retention/deletion process before real personal data is stored.
- Disabling UAT hides results through RLS without deleting them. It does not change CMMS operational policies.

## Adapter contract

`createUatRepository()` uses the existing Supabase client (publishable key + authenticated session); no service-role key and no second implicit database target.

- `createRun(scope, {id, tester, release})`
- `appendObservation(scope, runId, observation)`
- `loadOwnRuns(scope)` — own results only, filtered by site/role/scenario version. Admin coordinator view is not implemented yet.

Every operation rejects Demo mode, verifies the current Auth user matches the requested owner, then checks the database enable flag. RLS is the security boundary; these browser checks only prevent accidental misuse.

Generate a UUID **once per user action**, retain it while a request is pending/uncertain and reuse it for retries. A duplicate ID is accepted only when the existing RLS-visible payload matches. Different payloads produce an error; no upsert, overwriting or silent local fallback occurs. An unknown network outcome remains an error until retried with the same ID. The future UI must preserve draft contents and pending IDs until confirmed.

Loads paginate runs and observations, including when the server returns fewer rows than requested. Partial-load errors reject the whole load, not silently return incomplete results. Append order is server event order, not the user's clock. Pagination is not a transaction-wide snapshot: concurrent submissions may require a refresh. Do not treat it as a live subscription or atomic global report.

## Verification

Executed locally on 2026-10-04:

- `rtk npm run typecheck`: passed.
- `rtk npm run test`: 76 tests / 11 files passed, including 12 new mocked UAT adapter tests. Checks include Demo/config/session/gate rejection, error propagation, payload attribution exclusions, duplicate retry/conflict, validation, scoped mapping and pagination/partial failure.
- `rtk npm run build`: passed. Bundle unchanged because the adapter is not imported by the UI yet.
- PostgreSQL 16 in a new Docker container `thaicon-uat-check-20261004`, no network and no published ports, temporary database `thaicon_uat_check`; existing unrelated Supabase containers were not modified.
- Applied only a minimal Auth schema shim, the real access-foundation migration and the new UAT migration inside that disposable container. Executed `scripts/uat-db-check.sql` with `ON_ERROR_STOP=1`; assertions passed. Synthetic fixtures run in a transaction and roll back.
- Actual SQL checks cover default-disabled gate, non-admin inability to enable, role/catalog allowlist, owner/site isolation, Admin review without impersonation, User submissions, server attribution, immutable history, cross-site writes, forbidden role/time fields, disabled profile, inactive site, revoked assignment, and anonymous denial.
- After verification, the exact agent-created container was inspected, stopped and removed. Its temporary database is gone; no user database was removed. The committed-source candidates (migration and harness scripts) recreate the test setup; they remain uncommitted at this handoff.

These are real PostgreSQL grant/RLS checks, **not full Supabase acceptance**: Auth is a minimal SQL shim and the other five operational migrations, GoTrue/PostgREST, real JWT refresh, Storage and browser-to-server integration were not exercised. The isolated Docker check does not establish a customer-accessible UAT environment.

## Reproduce database check (local only)

Use an empty disposable PostgreSQL container with database name `thaicon_uat_check`, no network and no published ports; mount `scripts/` at `/checks` and `supabase/migrations/` at `/migrations` read-only. Do not use the running databases of another project. Scripts refuse a different database name, but this guard does not replace checking the actual container identity.

Run inside the newly created container with psql:

```text
psql -X -q -v ON_ERROR_STOP=1 -U postgres -d thaicon_uat_check \
  -f /checks/uat-db-bootstrap.sql \
  -f /migrations/202608190001_access_foundation.sql \
  -f /migrations/202610040001_uat_results.sql \
  -f /checks/uat-db-check.sql
```

Bootstrap/migrations are for the fresh container only; do not replay on a pre-existing database. The fixture check itself can rerun after its transaction rolls back. No new image was downloaded for the executed check; `postgres:16-alpine` already existed locally.

## Next steps before online use

1. Confirm hosted UAT project and costs/authorization, or prepare a separate full local Supabase stack for developer verification. Docker is available now; the older engine-unavailable note is superseded, but the running `tiche-mailer-local` stack is unrelated and must not be reused.
2. Apply migrations only after verifying the isolated target. Enable `private.uat_settings` explicitly there; keep disabled on Production. Do not expose an enable endpoint to application users.
3. Add opt-in frontend UAT configuration/gating and integrate the adapter with loading/error/pending/retry states and session/site-switch cancellation. Never automatically migrate browser-local evidence into online evidence.
4. Implement private image evidence, validated uploads and scoped download access; test Storage separately. Current evidence field is not an upload and no Storage policies were added.
5. Add coordinator review/comparison, real-role HTTP/Auth integration, cross-device persistence, outage retry and backup/restore checks. Re-test database policies in the complete Supabase schema.
6. Review exact intended files and obtain approval before commit/push/deploy or any remote write. Do not announce that online UAT is ready from the foundation alone.
