# ThaiCon CMMS

ระบบต้นแบบสำหรับบริหารงานบำรุงรักษาของ ThaiCon แยกออกจากเว็บไซต์บริษัทเพื่อให้พัฒนาและเผยแพร่ได้อย่างอิสระ

## ฟังก์ชันปัจจุบัน

- Dashboard งานบำรุงรักษา
- Demo Login และ Session persistence
- เลือก Jobsite ตามสิทธิ์ Admin, Engineer และ User
- กรอง Work Order, Alarm, PM, Asset และ IoT ตาม Jobsite ที่เลือก
- Work Order และ Alarm workflow
- แผน PM
- ทะเบียนเครื่องจักรและไซต์ลูกค้า
- IoT Monitor และ Telemetry แบบข้อมูลจำลอง
- User profile และ Logout integration
- Responsive UI สำหรับ Desktop และ Mobile
- Supabase schema และ RLS foundation สำหรับ User/Jobsite access
- Automated tests สำหรับ Demo Login และสิทธิ์ Jobsite

## บัญชีสำหรับทดสอบ

| บทบาท | ชื่อผู้ใช้งาน | รหัสผ่าน | Jobsite ที่เข้าถึงได้ |
| --- | --- | --- | --- |
| Admin | `admin` | `demo123` | ทุกไซต์ในข้อมูลตัวอย่าง |
| Engineer | `engineer` | `demo123` | SITE-001 และ SITE-002 |
| User | `user` | `demo123` | SITE-001 แบบ Viewer |

ระบบ Login ปัจจุบันเป็น demo authentication ฝั่ง Frontend เพื่อทดสอบหน้าจอและสิทธิ์เบื้องต้น ยังไม่ใช่ระบบรักษาความปลอดภัยสำหรับ Production

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

รายละเอียดการเตรียม Backend และ RLS อยู่ใน `docs/backend-foundation.md`

## การเผยแพร่

- Source repository นี้เก็บเฉพาะระบบ CMMS
- เว็บไซต์บริษัทอยู่ที่ `champln/thaicon-web-dev`
- ระบบ public ที่มี Login, Session และ Demo API เผยแพร่แยกจากเว็บไซต์บริษัท

ข้อมูลภายในระบบปัจจุบันเป็นข้อมูลจำลองสำหรับทดสอบหน้าจอและ workflow เท่านั้น
