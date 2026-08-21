# Production Activation Checklist

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

จากนั้น:

- โหลด `supabase/seed.sql` เฉพาะ Development
- Deploy `supabase/functions/admin-users`
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
- PDF ภาษาไทยเปิดได้ทั้ง Desktop และ Mobile

## 6. Production release

- Backup Development ก่อน promote schema
- Apply migration ชุดเดียวกันกับ Production
- ตั้ง GitHub Repository Variables เป็น Production values
- Deploy และตรวจ GitHub Actions
- Smoke test Login, Jobsite selector, Admin Center และ Service Report
- บันทึกผล UAT และผู้อนุมัติ release
