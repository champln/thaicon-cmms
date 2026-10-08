# UAT workspace — 2026-10-04

## สถานะ

เพิ่มหน้าทดสอบในโค้ดท้องถิ่นแล้ว แต่ **ยังไม่ใช่ระบบรับผล UAT ออนไลน์แบบรวมศูนย์** และยังไม่เผยแพร่ให้ลูกค้า ไม่มีการเปลี่ยน Production, migration, Auth, RLS หรือบริการโฮสต์ในรอบนี้

หน้าใหม่ใช้เมนู **ทดสอบระบบ UAT** หลังเลือกไซต์ แสดง 32 scenarios รวมทุกบทบาท (Admin 30; บางเคสสำหรับ Engineer/User เท่านั้น) โดยอ้างอิง ID ของชุดเดิม 26 เคส และเพิ่ม metadata/location/history/guide อีก 6 เคส เป็นการเขียนขั้นตอนรอบใหม่ ไม่แก้ผลย้อนหลังใน HTML/Excel วันที่ 2026-09-20 และยังไม่ใช่ traceability ครบทุกข้อจากเอกสารลูกค้า

## วิธีลอง

1. เปิดระบบท้องถิ่น `http://127.0.0.1:5181/` เข้า Demo และเลือกไซต์
2. เปิดเมนูทดสอบระบบ UAT กดเริ่มรอบทดสอบใหม่
3. ใส่ชื่อผู้ทดสอบและรุ่นระบบที่ผู้ประสานงานแจ้ง (รอบนี้ `local-unpublished-20261004`) ยืนยันใช้ข้อมูลจำลอง
4. เปิดเคส อ่านสิ่งที่ต้องเตรียม ทำตามขั้นตอน แล้วเทียบกับผลที่ควรได้
5. เลือกผ่าน / ไม่ผ่าน / ทดสอบไม่ได้ ระบุสิ่งที่เกิดขึ้นจริง แล้วกดบันทึกผลเคสนี้
6. ทดสอบซ้ำได้ ประวัติเดิมยังอยู่ สรุปนับเฉพาะผลล่าสุดต่อเคส
7. ส่งออก JSON พร้อมส่งภาพหลักฐานแยกให้ผู้ประสานงาน ชื่อไฟล์ในช่องหลักฐานเป็นเพียงข้อความอ้างอิง ไม่ใช่การอัปโหลด

ชื่อผู้ทดสอบเป็นข้อมูลที่ผู้กรอกระบุเอง ไม่ใช่ลายเซ็นหรือหลักฐานรับรองตัวบุคคล ห้ามใส่รหัสผ่าน token ข้อมูลผู้ป่วย หรือข้อมูลลูกค้าจริงในหมายเหตุ/ไฟล์

## การจัดเก็บและข้อจำกัด

- `src/uat.ts`: catalog, domain types, append-only observation utility, validation, latest-result summary
- `src/UatWorkspace.tsx`: lazy-loaded page, explicit save, run selection, search/status filter, JSON download
- `src/uat.css`: scoped navy/cyan/light design; native controls, 16px text, focus outline, responsive wrapping
- `src/uat.test.ts`: 10 unit tests; no database calls
- Key `thaicon-uat-v1:<mode>:<userId>:<role>:<siteId>`; scope segments URI-encoded. Storage is origin-local, not a security boundary. Other people using the same browser profile can inspect browser storage. Use a separate browser profile per tester and synthetic data only.
- There is no cloud result sync, attachment upload, import/merge UI, reviewer dashboard or sign-off. Operational Supabase mode does not change where UAT results are saved.
- Save is explicit. Unsaved text is lost when leaving the page, switching runs, filtering out the card or reloading; the page displays this warning. Export includes saved observations only.
- Read errors or invalid/version-mismatched archives block writes rather than overwriting existing data. Recovery download exposes the existing raw archive for manual support; do not delete it as a first troubleshooting step.
- Before saving, compare storage with the last loaded snapshot to detect another tab's changes. This is best-effort conflict detection, **not atomic locking**. Use one editing tab; future central persistence needs server-side concurrency control.
- Demo cannot record PASS/FAIL for SEC-01, SEC-02 or SYNC-01; only BLOCKED. Online cases require an approved isolated UAT system and developer-assisted authorization checks.
- Current parser accepts only this scenario version. Future scenario changes must retain compatibility or provide an explicit migration/export path before bumping the version.
- New scenarios use current UI roles: Engineer has Service Report, guide and UAT, not the Admin Work Order/Alarm pages. The UAT menu grants no new operational permissions.

## Verification performed

- `rtk npm run typecheck`: passed
- `rtk npm run test`: 10 files / 64 tests passed (includes 10 new UAT unit tests)
- `rtk npm run build`: passed; UAT JS is lazy-loaded (~32.9 kB before gzip), main bundle ~477.7 kB
- `rtk git diff --check`: passed
- In-app browser, local Demo Admin SITE-001: opened new page, created a synthetic recorder-check run, searched SEC-01, saved BLOCKED, reloaded and recovered result, appended another BLOCKED and verified both history entries with only one summarized case. No RLS test was executed and no PASS was recorded for SEC-01.
- Search no-match and status filter verified. Desktop screenshot inspected. Mobile portrait viewport override 375×812 (content width 360) and landscape 812×375 (content width 797) showed matching document scroll/client width; no document-level horizontal overflow. Full keyboard, screen-reader, enlarged-text and all-role browser acceptance remain pending.
- Export click initiated successfully. Browser download-event wait timed out, but the actual file was found and parsed at `C:/Users/MUBR-Service/Downloads/thaicon-uat-2026-10-04-demo-admin-SITE-001.json`: schema 1, browser-local-only, one run, two observations, 30 role-scoped scenarios. This checks file generation, not an upload.
- Synthetic local run: tester `DEV-AI-20261004 ตรวจหน้าบันทึกผล`, release `local-unpublished-20261004`, run ID prefix `4f8d27a1`. Keep separate from customer acceptance.
- Screenshot outside repo: workspace `outputs/uat-20261004/uat-workspace.jpg`.
- Development server was restarted on port 5181 and returned HTTP 200. Process IDs are not durable.

## งานก่อนส่งลิงก์ให้ลูกค้า

- [x] หน้า scenarios และบันทึกผลในเครื่อง พร้อมส่งออกไฟล์
- [ ] ทบทวน scenarios กับเอกสาร requirement/flow ลูกค้า และกำหนดเจ้าของแต่ละเคส
- [ ] ยืนยันปลายทางโฮสต์ UAT และ Supabase UAT **แยกจาก Production** รวมขอบเขตค่าใช้จ่าย ก่อนสร้าง/เผยแพร่บริการ
- [ ] เตรียมข้อมูลจำลองและบัญชีรายบุคคล แยกบทบาท/ไซต์ ไม่ใช้รหัส Demo กับบัญชีจริง
- [ ] พัฒนา schema/adapter สำหรับผลรวมกลางและที่เก็บภาพแบบ private; เพิ่ม forward migrations โดยไม่แก้ migration เดิม
- [ ] ทดสอบ authenticated RLS, disabled/anonymous denial, cross-site denial, ownership และ conflict/retry จริงบนฐานแยก
- [ ] เพิ่มหน้าผู้ประสานงานเปรียบเทียบผลและติดตาม defect; แยก latest result จาก historical observations และแยกผล unit/UI/customer
- [ ] ทดสอบข้ามเครื่อง/มือถือ/ดาวน์โหลด/Storage/backup-restore บนปลายทาง UAT
- [ ] ตรวจรายการไฟล์ที่จะเผยแพร่ และขออนุมัติ commit/push/deploy ใหม่
- [ ] ส่งลิงก์ UAT รุ่นที่ระบุแน่นอน พร้อมบัญชีรายบุคคล ระยะเวลาทดสอบ ผู้รับผล และช่องทางแจ้งปัญหา

การเลือก Docker สำหรับ integration ท้องถิ่นก่อนหน้ายังใช้ได้ ไม่ได้ทำให้ลูกค้านอกเครื่องเข้าถึง UAT โดยอัตโนมัติ และไม่ควรเปิดเครื่องพัฒนาออกอินเทอร์เน็ตหรือใช้ฐาน Production แทนโดยไม่มีการอนุมัติ
