# ThaiCon CMMS

ระบบต้นแบบสำหรับบริหารงานบำรุงรักษาของ ThaiCon แยกออกจากเว็บไซต์บริษัทเพื่อให้พัฒนาและเผยแพร่ได้อย่างอิสระ

## ฟังก์ชันปัจจุบัน

- Dashboard งานบำรุงรักษา
- Work Order และ Alarm workflow
- แผน PM
- ทะเบียนเครื่องจักรและไซต์ลูกค้า
- IoT Monitor และ Telemetry แบบข้อมูลจำลอง
- User profile และ Logout integration
- Responsive UI สำหรับ Desktop และ Mobile

## เริ่มต้นพัฒนา

```bash
npm install
npm run dev
```

ตรวจ production build:

```bash
npm run build
```

## การเผยแพร่

- Source repository นี้เก็บเฉพาะระบบ CMMS
- เว็บไซต์บริษัทอยู่ที่ `champln/thaicon-web-dev`
- ระบบ public ที่มี Login, Session และ Demo API เผยแพร่แยกจากเว็บไซต์บริษัท

ข้อมูลภายในระบบปัจจุบันเป็นข้อมูลจำลองสำหรับทดสอบหน้าจอและ workflow เท่านั้น
