# ThaiCon CMMS

## การรันทดสอบปัจจุบัน (2026-10-16)

Demo รันด้วย Node.js/Vite และเปิดให้ทดสอบผ่าน hostc ได้โดยไม่ใช้ Docker ข้อมูลอยู่ในเบราว์เซอร์ของแต่ละคน ไม่ซิงก์ข้ามเครื่อง ส่วนระบบออนไลน์ยังใช้ Supabase ตามเดิม

นำสคริปต์เริ่ม Docker และ integration tests ที่ผูกกับ Docker ออกจากโปรเจกต์แล้ว คำสั่ง `test:db`, `test:tor-db`, `test:tor-upgrade` ในบันทึกเก่าด้านล่างจึงใช้ไม่ได้ เก็บสำเนาไว้นอก Git ที่ `../../outputs/docker-retired-20261016` พร้อม configuration local เดิม; Docker volumes ยังเก็บไว้กู้คืน ฐานข้อมูลจริงและ migrations ไม่ได้ถูกลบ

สำหรับทดสอบผ่านอินเทอร์เน็ต ให้ build Demo โดยกำหนด `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY` เป็นค่าว่าง และ `VITE_BASE_PATH=/` เฉพาะโปรเซส build ไปยัง `dist-hostc` แล้วรัน:

```bash
npm run preview -- --outDir dist-hostc --host 127.0.0.1 --port 15190 --strictPort
npx --yes hostc@2.0.6 127.0.0.1:15190
```

ใช้ URL ที่ hostc แสดงล่าสุด และเปิดทั้งสองโปรเซสไว้ระหว่างทดสอบ การเปลี่ยน URL ทำให้ข้อมูล Demo ที่เก็บใต้ URL เดิมไม่ตามมา บันทึก checkpoint ด้านล่างเป็นประวัติการพัฒนา ไม่ใช่สถานะ deployment ปัจจุบัน

### Local TOR checkpoint (2026-10-06; not deployed)

Latest: scoped maintenance/Alarm realtime now wired locally, **21 total /15 unpublished migrations**, newest0014. Atomic scoped SQL snapshots include actual cycles/photo metadata/positive plan tombstones; actual actor role/site rechecked after private-photo preparation. Maintenance live refresh requires every owning command gate ON, preserving legacy dirty data; Alarm independently gated. Serialized invalidation/catch-up/poll/focus refresh, monotonic versions, retained forms/inline retry and latched authorization denial verified. User open report detail/export follows latest confirmed version; staff pending review key is retained and stale export gated. **288 units**, fresh21/populated-six upgrade, actual-JWT transport and PM browser regression PASS. Broad realtime stress cases and report/master-pagination/load-state work remain; this is not complete TOR/UAT acceptance. Gates remain OFF, no Git/deploy/Production writes. Latest AGENTS.md supersedes the historical notes below.

Newest local milestone: confirmed narrow Alarm acknowledgement (20 migrations total, fourteen unpublished), following Admin plan/cycle commands and canonical operations site IDs. Command ON has exact replay/actual receipt/audit; current React OFF uses only qualified boolean PATCH + receipt confirmation, never full-row Alarm autosync. Server sensor values and original receiver/time preserved; independent operations load/readiness failures have safe retry, not false zero totals. SQL races/populated-original-six upgrade and real-JWT React regressions pass. Next: broad maintenance/Alarm realtime (currently only WO realtime), then reports/master-pagination/audit/UAT prep. Run `npm run test:tor-upgrade` for baseline preservation. No Production/deployment authority; latest AGENTS.md supersedes earlier notes.

Service Report forms/reviews now use versioned, idempotent commands with server confirmation, retained drafts on conflicts and same-request retry. Online load/readiness errors do not expose cached Demo maintenance or permit writes/exports. Both report gates remain default-OFF; partial configurations fail closed. Seventeen migrations total (eleven unpublished). Plans/manual repairs remain legacy writes; report-linked repairs are temporarily read-only. See the latest AGENTS.md checkpoint for verified evidence, limits and continuation tasks. Commit/push/production activation requires human approval.

ระบบต้นแบบสำหรับบริหารงานบำรุงรักษาของ ThaiCon แยกออกจากเว็บไซต์บริษัทเพื่อให้พัฒนาและเผยแพร่ได้อย่างอิสระ

## ฟังก์ชันปัจจุบัน

สถานะชุด TOR ล่าสุด (ยังไม่เผยแพร่): ใบงานแบบมอบหมาย/ดำเนินการ/ตรวจรับพร้อมประวัติและรุ่นข้อมูล, วัสดุที่ใช้จริงพร้อมเหตุผลยกเลิก, ลูกค้าดูใบงานและประวัติรายเครื่องแบบอ่านอย่างเดียว, ค้นวันที่สร้าง/ผู้รับผิดชอบ, PDF/Excel ของวัสดุและกิจกรรมพร้อมเวลาออกไฟล์ และ UAT ฐานกลางเมื่อฐานทดสอบเปิด gate แล้ว รายละเอียดผลทดสอบและ checklist ที่ยังเหลืออยู่ใน `AGENTS.md` ห้ามถือว่า build ผ่านหมายถึงตรวจรับ TOR ครบ

- Dashboard Plan เทียบ Actual จากผล Service Report ที่อนุมัติแล้ว
- Supabase Auth adapter พร้อม Demo Login fallback
- เลือก Jobsite ตามสิทธิ์ Admin, Engineer และ User
- กรอง Work Order, Alarm, PM, Asset และ IoT ตาม Jobsite ที่เลือก
- Work Order และ Alarm workflow พร้อม Supabase adapter และ RLS
- แผนงานรายปี แบ่งรอบ 1, 2 หรือ 3 เดือน พร้อมเป้าหมายและงานคงเหลือ
- Service Report แบบ Draft / ส่งอนุมัติ / อนุมัติ / ส่งกลับ พร้อมแนบภาพ
- ดาวน์โหลด Service Report เป็น PDF
- ใบแจ้งซ่อมที่เชื่อมจาก Service Report และดาวน์โหลด PDF
- รายงานผลรายปี รายเดือน และรายรอบ
- รายงานกรองตามปี เดือน แผน และรอบ พร้อมดาวน์โหลด PDF
- แจ้งเตือนรอบ PM เกินกำหนด ใกล้ครบกำหนด และ Service Report รออนุมัติ
- Admin Center จัดการไซต์ ผู้ใช้/สิทธิ์ และทะเบียนเครื่องจักรทั้งโหมด Demo และ Supabase
- ทะเบียนตำแหน่งติดตั้งรายไซต์ พร้อมอาคาร ชั้น ห้อง ผู้ผลิต รุ่น และ Serial Number
- ประวัติเครื่องจักรจากใบงาน Service Report และใบแจ้งซ่อมของเครื่องและไซต์เดียวกัน
- IoT Monitor และ Telemetry แบบข้อมูลจำลอง
- User profile และ Logout integration
- Responsive UI สำหรับ Desktop และ Mobile
- Supabase schema และ RLS สำหรับ User/Jobsite, เครื่องจักร, แผนงาน, Service Report, รูปภาพ และใบแจ้งซ่อม
- Automated tests สำหรับ Login, สิทธิ์ Jobsite, Supabase data mapping และกฎ Plan/Actual

## บัญชีสำหรับทดสอบ

| บทบาท | ชื่อผู้ใช้งาน | รหัสผ่าน | Jobsite ที่เข้าถึงได้ |
| --- | --- | --- | --- |
| Admin | `admin` | `demo123` | ทุกไซต์ในข้อมูลตัวอย่าง |
| Engineer | `engineer` | `demo123` | SITE-001 และ SITE-002 |
| User | `user` | `demo123` | SITE-001 แบบ Viewer |

หากยังไม่กำหนดค่า Supabase ระบบจะใช้บัญชีทดสอบด้านบนโดยอัตโนมัติ บัญชีเหล่านี้ใช้สำหรับตรวจหน้าจอเท่านั้น

ข้อมูลแผนงานและ Service Report สำหรับทดสอบอยู่ใน `src/maintenance.ts` ส่วนข้อมูลไซต์ ผู้ใช้ และเครื่องจักรอยู่ใน `src/master-data.ts` การแก้ไขโหมด Demo บันทึกใน Local Storage ของ Browser ด้วย key `thaicon-cmms-maintenance-v3` และ `thaicon-cmms-master-data-v1` ใบงานและสถานะรับทราบ Alarm ใช้ key `thaicon-cmms-demo-operations-v1` แยกจาก Supabase ข้อมูล Demo อยู่เฉพาะเบราว์เซอร์/ต้นทางเว็บนั้น ไม่ซิงก์ข้ามเครื่อง และควรแก้ไขจากแท็บเดียวในแต่ละครั้ง

## เริ่มต้นพัฒนา

```bash
npm install
npm run dev
```

ตรวจ production build:

```bash
npm run typecheck
npm test
npm run build
```

เปิดใช้ Supabase Auth โดยคัดลอก `.env.example` เป็น `.env.local` แล้วกำหนด:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

เมื่อกำหนดครบ ระบบออนไลน์รองรับชื่อผู้ใช้ผ่าน `username-login` และยังรองรับอีเมล ระบบโหลด/บันทึก Master Data, Work Order, Alarm, แผนงาน, Service Report, รูปภาพ และใบแจ้งซ่อมผ่าน Supabase ส่วนบัญชี Demo ยังคงแยกข้อมูลจำลอง ฐานที่เผยแพร่ก่อนหน้ามี migration 6 ไฟล์; ชุด TOR/UAT เพิ่มอีก 9 ไฟล์ที่ยังไม่รันออนไลน์ ก่อนใช้งานให้ตรวจ schema/history และ Edge Functions `admin-users` กับ `username-login` ตามคู่มือ ห้ามรัน migration เก่าซ้ำหรือเปิด gate บนฐานจริงเพียงเพราะการทดสอบในเครื่องผ่าน

ตำแหน่งติดตั้งสร้างได้โดย Admin และผูกกับเครื่องจักรในไซต์เดียวกันเท่านั้น โครงสร้างฐานข้อมูลปัจจุบันอนุญาตให้อ่าน/เพิ่มตำแหน่ง แต่ไม่อนุญาตแก้ไข/ลบตำแหน่งที่บันทึกแล้ว หากไม่ผูกทะเบียน ยังระบุตำแหน่งเองได้

รายละเอียดการเตรียม Backend และ RLS อยู่ใน `docs/backend-foundation.md`

## การเผยแพร่

- Source repository นี้เก็บเฉพาะระบบ CMMS
- เว็บไซต์บริษัทอยู่ที่ `champln/thaicon-web-dev`
- ระบบ public ที่มี Login, Session และ Demo API เผยแพร่แยกจากเว็บไซต์บริษัท
- GitHub Pages อ่านค่า Supabase จาก Repository Variables ชื่อ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY`

ข้อมูลที่มากับ source เป็นข้อมูลจำลองสำหรับทดสอบหน้าจอและ workflow เท่านั้น
