# ThaiCon CMMS

ระบบต้นแบบสำหรับบริหารงานบำรุงรักษาของ ThaiCon แยกออกจากเว็บไซต์บริษัทเพื่อให้พัฒนาและเผยแพร่ได้อย่างอิสระ

## ฟังก์ชันปัจจุบัน

- Dashboard งานบำรุงรักษา
- Supabase Auth adapter พร้อม Demo Login fallback
- เลือก Jobsite ตามสิทธิ์ Admin, Engineer และ User
- กรอง Work Order, Alarm, PM, Asset และ IoT ตาม Jobsite ที่เลือก
- Work Order และ Alarm workflow
- แผน PM
- ทะเบียนเครื่องจักรและไซต์ลูกค้า
- IoT Monitor และ Telemetry แบบข้อมูลจำลอง
- User profile และ Logout integration
- Responsive UI สำหรับ Desktop และ Mobile
- Supabase schema และ RLS foundation สำหรับ User/Jobsite access
- Automated tests สำหรับ Login, สิทธิ์ Jobsite และ Supabase data mapping

## บัญชีสำหรับทดสอบ

| บทบาท | ชื่อผู้ใช้งาน | รหัสผ่าน | Jobsite ที่เข้าถึงได้ |
| --- | --- | --- | --- |
| Admin | `admin` | `demo123` | ทุกไซต์ในข้อมูลตัวอย่าง |
| Engineer | `engineer` | `demo123` | SITE-001 และ SITE-002 |
| User | `user` | `demo123` | SITE-001 แบบ Viewer |

หากยังไม่กำหนดค่า Supabase ระบบจะใช้บัญชีทดสอบด้านบนโดยอัตโนมัติ บัญชีเหล่านี้ใช้สำหรับตรวจหน้าจอเท่านั้น

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

เมื่อกำหนดครบ หน้า Login จะเปลี่ยนเป็นอีเมล/รหัสผ่านและโหลด Profile กับ Jobsite ตาม RLS จาก Supabase

รายละเอียดการเตรียม Backend และ RLS อยู่ใน `docs/backend-foundation.md`

## การเผยแพร่

- Source repository นี้เก็บเฉพาะระบบ CMMS
- เว็บไซต์บริษัทอยู่ที่ `champln/thaicon-web-dev`
- ระบบ public ที่มี Login, Session และ Demo API เผยแพร่แยกจากเว็บไซต์บริษัท
- GitHub Pages อ่านค่า Supabase จาก Repository Variables ชื่อ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY`

ข้อมูลภายในระบบปัจจุบันเป็นข้อมูลจำลองสำหรับทดสอบหน้าจอและ workflow เท่านั้น
