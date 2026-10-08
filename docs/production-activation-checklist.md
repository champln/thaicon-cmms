# Production Activation Checklist

Latest local verification (2026-10-06): **21 total /15 unpublished migrations unchanged; 331 units/42files, typecheck/build, isolated actual-JWT PM/report regression PASS.** WO summary and unified PM XLSX/PDF are local only, not deployed. PM zero-target percentage is not assessed; monthly Actual/full-cycle target has no invented monthly percentage/remaining. Report readiness/scope/model-change failure blocks exports. Remaining source-complete asset/history/material report families, realtime stress, customer UAT and Production backup/restore preflight are NOT complete. Latest actual isolated gates were preserved/restored WO/Alarm/UAT=true and SR reviews/drafts/plan/repair=false; older all-OFF claims below are historical and superseded. Do not infer or change Production gate values without checking actual target and obtaining approval. Follow latest AGENTS.md; no commit/push/deploy/Production authority from these local passes.

Newest local read/realtime milestone: **21 total /15 unpublished migrations**, newest0014. No migration/client/gate deployment authorized. Keep existing gates OFF pending staging/legacy preflight and explicit approval. Atomic live snapshot/read-context RPCs and additive publication must exist before any client/gate activation; missing/failed RPC must remain unavailable, not legacy fallback. Verify actual actor/role/site again after signing private photos, same-identity role downgrade, sticky denied retry, retained modal drafts/keys, positive deletion evidence and no fresh-remote autosync-back. Maintenance refresh only with all owning command gates ON, Alarm separately. >8MiB is a visible failure, not production large-site capacity proof. Direct owner child edits/Alarm hard deletions have no certified realtime/deletion contract. Local 288 units/SQL/JWT/browser passes do not replace customer UAT, full realtime stress, legacy data preflight or off-site DR. Remaining gates restored OFF; historical counts/limitations below are superseded.

Newest local Alarm milestone: **20 total /14 unpublished migrations**, newest0013. Keep `private.alarm_settings.enabled` OFF until approved migration/client activation. ON requires narrow `acknowledge_alarm_command` + exact replay/actual receiver/time/audit; browser direct writes then blocked. Current frontend OFF is also narrow/confirmed (boolean-only site-qualified PATCH), excluding all Alarm full-row autosync, but OFF is not a UUID ledger. Verify active role/site, concurrent receipt, stale sensor preservation, audit rollback and unknown outcome retry on staging. All local gates restored OFF. Broad maintenance/Alarm realtime is still pending; no Production authority follows from local passes. Older optimistic-ACK notes below are historical and superseded.

Latest local milestone: **19 total /13 unpublished migrations**, newest0012. Keep plan/repair/report gates OFF until human-approved migration/client activation. Plan commands have an independent default-OFF gate; active Admin only, versioned create/save/unreferenced delete, retained audit and positive scoped tombstone read. Repair ON still requires both report gates ON. Verify real active/role/owner/site readiness and plan-only Engineer report compatibility; gate-ON plans/repairs/reports must never reach legacy autosync. Canonical site-ID correction now passes same-name/rename and legacy-Demo preservation tests. Alarm acknowledgement is still optimistic legacy autosync: requires narrow server-confirmed retry-safe operation before broad realtime/customer rollout. Customer UAT/Production legacy preflight/DR remain pending. Local passes do not authorize Production; earlier notes are historical and latest AGENTS.md takes precedence.

Earlier SR-only frontend checkpoint (superseded plan/repair limitations): React SR save/review commands are wired, but this is not deployment authorization. Keep both `reviews_enabled` and `drafts_enabled` OFF on Production until approved migrations/client deployment and readiness verification. Both ON are required for the full command UI; a partial configuration fails closed. Linked-repair edit/delete was temporarily read-only and plans/manual repairs still used legacy autosync at that earlier checkpoint. Local synthetic tests do not certify historical Production rows, complete Storage atomicity or customer UAT acceptance.

## ชุด TOR/UAT ที่ยังไม่เผยแพร่ (2026-10-06)

- ตรวจและสำรองฐานจริงก่อนพิจารณา migration ใหม่ 15 ไฟล์ ห้ามรันทั้งชุดจากผลทดสอบ local โดยไม่เทียบ schema/history
- ตรวจ legacy scope ที่ยังเป็น NOT VALID และแผนรองรับ client เก่าก่อนเปิด Work Order command gate; UAT gate เปิดเฉพาะฐาน UAT แยก
- ทดสอบ snapshot รุ่นที่จะส่งขึ้นจริง รวม JWT/Storage/Realtime/Edge และแผน rollback/restore; local drill ไม่ใช่ Production backup
- ตกลง standalone CM/EM, ยกเลิก/เปิดงานใหม่, ปีสัญญา และ support/contract พร้อมลูกค้า ตาม checklist ล่าสุดใน `AGENTS.md`
- ขออนุมัติ commit/push/deploy และ target/gate ก่อนทุกการเผยแพร่หรือเปลี่ยนฐานออนไลน์

## 1. Supabase projects

- สร้าง Supabase แยก Development และ Production
- ติดตั้งและ Login Supabase CLI
- Link repository กับ Development project ก่อน
- ห้ามเก็บ access token, database password หรือ service-role key ใน Git

## 2. Database and Edge Function

รัน migration ตามลำดับ:

1. `202608190001_access_foundation.sql`
2. `202608210001_maintenance_workflow.sql`
3. `202608210002_admin_master_data.sql`
4. `202608210003_operations_workflow.sql`
5. `202609150001_asset_metadata.sql`
6. `202609150002_location_catalog.sql`

สำหรับโครงการที่ติดตั้งแล้ว ให้ตรวจประวัติ migration ก่อน ห้ามรันไฟล์เก่าซ้ำหรือ reset ฐานข้อมูลจริง

จากนั้น:

- โหลด `supabase/seed.sql` เฉพาะ Development
- Deploy `supabase/functions/admin-users`
- Deploy `supabase/functions/username-login` ตาม `supabase/config.toml`
- ตรวจว่า Edge Function มี `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ใน server environment
- รัน `npm run test:db`

## 3. First administrator

- สร้างบัญชีแรกผ่าน Supabase Auth Dashboard
- ตรวจว่า trigger สร้าง `profiles` row
- เปลี่ยน role เป็น `admin`
- Login ด้วยบัญชีแรก แล้วสร้างบัญชีอื่นจาก Admin Center
- ทดสอบปิดบัญชีและกำหนดสิทธิ์หลาย Jobsite

## 4. Frontend configuration

Local Development ใช้ `.env.local`:

```bash
VITE_SUPABASE_URL=https://project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=publishable-key
```

GitHub Pages ใช้ Repository Variables ชื่อเดียวกัน ห้ามใช้ service-role key

## 5. UAT gates

- Admin เห็นและจัดการได้ทุก Jobsite
- Engineer เห็นเฉพาะ Jobsite ที่ได้รับสิทธิ์และทำ Service Report ได้
- User เปิดแผนและดาวน์โหลดรายงานได้โดยแก้ไขไม่ได้
- ผู้ใช้จาก SITE-001 อ่านข้อมูล SITE-002 ไม่ได้
- รูป Service Report เปิดผ่าน signed URL และบัญชีอื่นเข้าถึงไม่ได้
- Work Order, Alarm, Plan, Service Report และ Repair Request ยังอยู่หลัง logout/login และเปิดจากอีกเครื่อง
- Actual นับเฉพาะ Service Report สถานะ Approved
- Alarm acknowledgement มีผู้รับทราบและเวลา server
- Metadata เครื่องจักรบันทึกครบ และเลือกตำแหน่งจากไซต์อื่นไม่ได้ทั้งผ่านหน้าจอและคำขอฐานข้อมูล
- PDF ภาษาไทยเปิดได้ทั้ง Desktop และ Mobile

## 6. Production release

- Backup Development ก่อน promote schema
- สำรอง Production ก่อนเปลี่ยนข้อมูลจริง และทดสอบกู้คืนในสภาพแวดล้อมแยก (ยังไม่มีผลยืนยัน ณ 2026-09-21)
- Apply migration ชุดเดียวกันกับ Production
- ตั้ง GitHub Repository Variables เป็น Production values
- Deploy และตรวจ GitHub Actions
- Smoke test Login, Jobsite selector, Admin Center และ Service Report
- บันทึกผล UAT และผู้อนุมัติ release

## Additional unpublished review foundation (2026-10-06)

Updated 2026-10-08: 22 migration files (six historical, sixteen unpublished). Transactional draft/review/repair/plan/WO/material/Alarm UI is connected locally; the older warning that review UI was not connected is superseded. This does NOT authorize Production activation. Keep independent gates OFF until approved rollout, legacy preflight, backup/restore and compatible frontend release. Never treat local integration tests as customer acceptance.

The read-only `202610080001_material_ledger_context.sql` adds a ledger-specific guard without enabling a gate or modifying records. Online material exports require it and the existing WO command gate. Deploying the frontend without this RPC shows an explicit unavailable error rather than a false empty ledger. Test actual User/Engineer/Admin identity, active-site assignments, gate-OFF denial, missing-RPC handling, concurrent parent-version change, late read failures and revoked access before enabling customer exports.

Local evidence: fresh22/populated-six-to22 migration suites, actual-JWT material export/read-outage/revocation checks and Demo exports passed. Existing data/approved Actual preserved in the upgrade fixture. Migration history or local tests alone are not a live schema/preflight/DR guarantee. See latest `AGENTS.md` checkpoint for full evidence and limitations.
