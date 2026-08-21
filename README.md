# ThaiCon CMMS

ระบบต้นแบบสำหรับบริหารงานบำรุงรักษาของ ThaiCon แยกออกจากเว็บไซต์บริษัทเพื่อให้พัฒนาและเผยแพร่ได้อย่างอิสระ

## ฟังก์ชันปัจจุบัน

- Dashboard Plan เทียบ Actual จากผล Service Report ที่อนุมัติแล้ว
- Supabase Auth adapter พร้อม Demo Login fallback
- เลือก Jobsite ตามสิทธิ์ Admin, Engineer และ User
- กรอง Work Order, Alarm, PM, Asset และ IoT ตาม Jobsite ที่เลือก
- Work Order และ Alarm workflow
- แผนงานรายปี แบ่งรอบ 1, 2 หรือ 3 เดือน พร้อมเป้าหมายและงานคงเหลือ
- Service Report แบบ Draft / ส่งอนุมัติ / อนุมัติ / ส่งกลับ พร้อมแนบภาพ
- ดาวน์โหลด Service Report เป็น PDF
- ใบแจ้งซ่อมที่เชื่อมจาก Service Report และดาวน์โหลด PDF
- รายงานผลรายปี รายเดือน และรายรอบ
- รายงานกรองตามปี เดือน แผน และรอบ พร้อมดาวน์โหลด PDF
- แจ้งเตือนรอบ PM เกินกำหนด ใกล้ครบกำหนด และ Service Report รออนุมัติ
- Admin Center จัดการไซต์ ผู้ใช้/สิทธิ์ และทะเบียนเครื่องจักร
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

ข้อมูลแผนงานและ Service Report สำหรับทดสอบอยู่ใน `src/maintenance.ts` ส่วนข้อมูลไซต์ ผู้ใช้ และเครื่องจักรอยู่ใน `src/master-data.ts` การแก้ไขโหมด Demo บันทึกใน Local Storage ของ Browser ด้วย key `thaicon-cmms-maintenance-v3` และ `thaicon-cmms-master-data-v1`

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

เมื่อกำหนดครบ หน้า Login จะเปลี่ยนเป็นอีเมล/รหัสผ่าน โหลด Profile กับ Jobsite ตาม RLS และบันทึกแผนงาน Service Report รูปภาพ และใบแจ้งซ่อมลง Supabase โดยอัตโนมัติ ก่อนใช้งาน Production ให้ apply migration ทั้ง 3 ไฟล์และ deploy Edge Function `admin-users` ตามลำดับ

รายละเอียดการเตรียม Backend และ RLS อยู่ใน `docs/backend-foundation.md`

## การเผยแพร่

- Source repository นี้เก็บเฉพาะระบบ CMMS
- เว็บไซต์บริษัทอยู่ที่ `champln/thaicon-web-dev`
- ระบบ public ที่มี Login, Session และ Demo API เผยแพร่แยกจากเว็บไซต์บริษัท
- GitHub Pages อ่านค่า Supabase จาก Repository Variables ชื่อ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY`

ข้อมูลที่มากับ source เป็นข้อมูลจำลองสำหรับทดสอบหน้าจอและ workflow เท่านั้น
