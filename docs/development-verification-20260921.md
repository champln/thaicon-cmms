# Development verification — 2026-09-21

Scope: continue development while customer UAT is deferred. These are developer regression checks, not customer acceptance or a Production release.

## Changes

- Persist Demo Work Orders and Alarm acknowledgements under `thaicon-cmms-demo-operations-v1`; handle invalid/unavailable storage without preventing login. Never load/save that key in online mode. Remount CMMS when identity/session mode changes.
- Replace the 40-value random Work Order ID pool with `WO-<UUID>` for new records and use actual creation time. Existing records/IDs are preserved.
- Expose building, floor, room, manufacturer, model, serial number and location_id through models, Supabase adapters, Admin forms and asset profiles. Search by these fields.
- Admin can list/create site-specific location paths and assign them to an asset in that same site. Selecting another site clears the selected location. Reject a room without a floor and duplicate paths. Catalog rows remain immutable because the current database grants SELECT/INSERT only; no new UPDATE/DELETE permissions were added.
- Replace hard-coded asset timeline with site/asset-scoped Work Orders, Service Reports and Repair Requests, with loading/error/empty states.
- Refresh setup documentation for six migrations, username login, isolated Demo and both Edge Functions.

## Automated checks

- `npm run typecheck`: passed.
- `npm test`: 7 files / 39 tests passed (23 existing + 16 new).
- `npm run build`: passed.
- New checks cover storage reload/empty/corrupt/quota failure, site preservation, Demo storage key isolation, legacy master data, metadata payloads, location validation/same-site restrictions, catalog roundtrip and history filtering.

## Browser regression evidence

Environment: local Vite `http://127.0.0.1:5181/`, isolated Demo browser origin, working tree based on b0709a1. No customer data, production writes, migration applications or deployments.

| Check | Result / evidence |
| --- | --- |
| Create → reload Work Order | PASS. `DEV-AI-20260921 ตรวจการบันทึกใบงาน`, WO-2607-0158 (created before the ID improvement), remained after reload. |
| New UUID ID → reload | PASS. `DEV-AI-20260921 UUID regression`, WO-296fba6c-d69b-4807-9407-194e251a7ab3, remained after reload. |
| Site switching | PASS. First test order absent from SITE-002, present again in SITE-001. |
| Role switching | PASS. User sees only SITE-001 and its existing read-only menus; Engineer sees SITE-001/002 and its existing Service Report menu; neither exposes Admin Center. Returning to Admin preserves the first test order. |
| Alarm acknowledgement → reload | PASS. ALT-6721 still displays รับทราบแล้ว after reload. |
| Location validation | PASS. Room with blank floor rejected; after entering ชั้น 2, DEV-AI อาคารทดสอบ / ห้อง 201 saved under SITE-001. |
| Cross-site dropdown | PASS. Switching asset to SITE-002 removes the SITE-001 location option and clears its selection. Switched back before saving. |
| Metadata persistence | PASS. CR-DP-02 saved with DEV-AI Maker, MODEL-2026, DEV-SN-20260921 and the location above; displayed after reload. |
| Serial search / asset history | PASS. Serial search finds CR-DP-02; history displays its stored test Work Order and existing order, with empty report/repair sections rather than invented events. |
| Responsive views | Inspected desktop and 390×844 screenshots of asset form/profile; controls stack vertically on mobile and modal scrolls. |
| Console | No captured error logs in the local browser check. |

Original 2026-09-20 UAT comparison files are unchanged. BUG-01 has a local fix and developer regression pass; its historical failed baseline must remain intact.

## Still pending

- Real Supabase metadata/catalog create/save/reload and negative RLS testing with staging identities, including failed online requests. Existing SQL constraints are not a substitute for executed tests.
- Complete customer UAT, PDF/photos and full workflow validation.
- Separate staging provisioning, validated customer data, complete backup and restore drill, live IoT integration.
- Requirement traceability against both original customer documents (not re-audited in this change).
- Demo is browser-local and is not a concurrent multi-tab or cross-device database. Use one editing tab per origin. Synthetic data remains only on the local test origin.
- Existing Work Order form due-label defaults, team selection and free-text details were not overhauled in this task; verify their existing behavior in the later workflow pass.
- Commit, push and deployment require fresh user approval. No new migrations are required for this frontend change if all six baseline migrations are already applied.
