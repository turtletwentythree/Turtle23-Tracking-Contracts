# Contract Tracking System (Turtle 23)

เว็บแอปติดตามสัญญา หน้าตาและการทำงานตามต้นแบบ `turtletwentythree/Project-Contract-tracking`
ใช้ **Supabase** เป็นฐานข้อมูล เข้าระบบด้วย **Microsoft 365** และ deploy บน **GitHub Pages** (ไม่มีขั้นตอน build)

## หน้าต่าง ๆ

| หน้า | สิทธิ์ขั้นต่ำ | ทำอะไรได้ |
|---|---|---|
| Dashboard | Viewer | KPI 4 ตัว, สัญญาค้างนานสุด, เวลาเฉลี่ยต่อแผนก, สรุปรายคน/รายแผนก (G/Y/R) |
| Contracts | Viewer | ตารางสถานะสัญญา กรองตามคอลัมน์ ค้นหา Export CSV กดรหัสสัญญาเพื่อดูรายละเอียดและ Log |
| Confidential | Confidential | ตารางสัญญาลับ |
| User Case Action | User | Add Case → Update Status → Close Case → Request Due Date (นับ SLA เฉพาะวันทำการ จ.–ศ.) |
| Master Data | Root | Contract Records, Departments, People, Contract Types, Action SLA + Import/Export CSV |
| Admin Tools | Admin | อนุมัติ Due Date, กำหนดสิทธิ์ผู้ใช้, ข้อความแจ้งเตือน LINE (Y/R) |

บัญชีอีเมลแต่ละบัญชีได้สิทธิ์ตาม Level เมนูที่ไม่มีสิทธิ์จะถูกซ่อน พิมพ์ URL ตรงก็จะถูกพากลับไป Dashboard และฐานข้อมูลบังคับสิทธิ์เดียวกันด้วย Row Level Security

| Level | บัญชี | ชื่อสิทธิ์ | เมนูที่เห็น |
|---|---|---|---|
| 1 | Viewer | Contract Viewer | Dashboard, Contracts |
| 2 | User | Contract User | Dashboard, Contracts, User Case Action |
| 3 | Confidential | Confidential User | Dashboard, Contracts, Confidential, User Case Action |
| 4 | Admin | System Administrator | Dashboard, Contracts, Confidential, User Case Action, Admin Tools |
| 5 | Root | Root System Administrator | Dashboard, Contracts, Confidential, User Case Action, Master Data, Admin Tools |

## โครงสร้างไฟล์

```
index.html                    หน้าเว็บ
assets/app.js                 ตรรกะของแอป
assets/store.js               ชั้นข้อมูล (Supabase หรือโหมดสาธิต)
assets/config.js              ค่าเชื่อมต่อ (ว่าง = โหมดสาธิต)
assets/seed-data.js           ข้อมูลตั้งต้นสำหรับโหมดสาธิต
assets/styles.css, logo.png
supabase/migrations/001_schema.sql   ตาราง, role, RLS
supabase/migrations/002_seed.sql     ข้อมูลตั้งต้น 28 สัญญา + master data
supabase/migrations/003_entra_roles.sql  สิทธิ์จาก Entra App Role, ประวัติการเปลี่ยนสิทธิ์, กัน Admin หมด
supabase/migrations/004_menu_access.sql  สิทธิ์อ่าน Master Data ตามเมนูของแต่ละ Level
supabase/migrations/006_root_level.sql  Level 5 Root: แก้ Master Data ได้คนเดียว, ให้/ถอด Level 5 ได้เฉพาะ Root
supabase/migrations/005_snapshot_import.sql  นำเข้า production_snapshot.json จาก Admin Tools (เพิ่มหรืออัปเดต ไม่ลบ)
supabase/migrations/007_log_view.sql    Log View: คอลัมน์ครบทุกช่องของ logs.csv และหัวตาราง Log View (log_view_columns)
supabase/migrations/008_master_data.sql Master Data: Lock แถวที่แก้ไขเอง (Import ไม่เขียนทับ), ประวัติการแก้ไข (master_audit), กันลบแถวที่ยังถูกใช้
supabase/migrations/009_log_edit.sql    Log View Detail แก้ไขได้ใน Master Data: Lock log ที่แก้ไขเอง (Import ไม่เขียนทับ) และเก็บประวัติ
supabase/migrations/010_email_attachments.sql อีเมลจาก User Case Action: Attachment Required ต่อ Action, email_log, ผู้อนุมัติ Due Date
supabase/migrations/011_storage_attachments.sql ไฟล์แนบเก็บใน Supabase Storage (bucket ส่วนตัว attachments, 20 MB ต่อไฟล์, เฉพาะ PDF/Word/Excel/PowerPoint/JPG/PNG) ไม่ใช้ Google Drive
supabase/migrations/012_email_outbox.sql email_outbox: กันอีเมลซ้ำด้วย requestId, สถานะ queued/sending/sent/failed
supabase/migrations/013_own_cases.sql    User Case Action: Level 1-3 ทำได้เฉพาะเคสที่ตัวเองเป็น Contract Owner หรือ Station Owner
supabase/migrations/014_line_notify.sql  LINE Notification: ตั้งค่า (Automatic เริ่มที่ Off) และบันทึกการส่ง (สูงสุดวันละ 1 ครั้งต่อสัญญา)
supabase/migrations/015_app_switch.sql  สวิตช์เปิด/ปิด: การเข้าใช้งาน Web app (Level 1-3, บังคับในฐานข้อมูล) และการส่ง LINE อัตโนมัติ พร้อมประวัติ
supabase/migrations/016_line_sending.sql  สวิตช์หลัก “การส่ง LINE Notification” เปิด/ปิด (ปิดแล้วไม่ส่งเลยทั้งอัตโนมัติและ Send Now) พร้อมผู้เปลี่ยนล่าสุด
supabase/functions/send-email/      Edge Function ส่งอีเมล (Resend หรือ Microsoft Graph) วิธีติดตั้งดู README-TH.md ในโฟลเดอร์นั้น
supabase/functions/line-notify/     Edge Function แจ้งเตือน Y/R เข้ากลุ่ม LINE ทุกวันทำการ 09:30 วิธีติดตั้งดู README-TH.md ในโฟลเดอร์นั้น
supabase/functions/_shared/sla-engine.js  กฎ SLA ชุดเดียวที่ทั้งเว็บและ LINE ใช้ร่วมกัน
.github/workflows/deploy.yml         deploy ขึ้น GitHub Pages
```

## ตั้งค่า Supabase

1. สร้างโปรเจกต์ที่ https://supabase.com
2. เปิด **SQL Editor** แล้วรัน `supabase/migrations/001_schema.sql`, `002_seed.sql`, `003_entra_roles.sql`, `004_menu_access.sql` และ `005_snapshot_import.sql` ตามลำดับ
3. ตั้งตัวเองเป็น admin คนแรก (ใช้อีเมล Microsoft 365 ของคุณ):
   ```sql
   insert into public.user_access (email, display_name, role)
   values ('your.name@turtle23.com', 'Your Name', 'admin')
   on conflict (email) do update set role = 'admin', active = true;
   ```

## เข้าระบบด้วย Microsoft 365

ผู้ใช้พิมพ์อีเมล @turtle23.com แล้วกด **Sign in with Microsoft 365** ระบบส่งอีเมลเป็น `login_hint` ไปที่ Microsoft Entra ของ Turtle23 (ล็อก tenant ด้วย Azure Tenant URL) และถามรหัสผ่านทุกครั้ง ระบบจับคู่อีเมลกับตาราง `user_access` เพื่อกำหนดสิทธิ์

**A. ลงทะเบียนแอปใน Microsoft Entra ID** (https://entra.microsoft.com → App registrations → New registration)
- Name: `Contract Tracking System`
- Supported account types: **Accounts in this organizational directory only** (เฉพาะบริษัท)
- Redirect URI (Web): `https://<project-ref>.supabase.co/auth/v1/callback`
- หลังสร้าง จด **Application (client) ID** และ **Directory (tenant) ID**
- Certificates & secrets → New client secret → จด **Value** (เก็บไว้ใส่ใน Supabase เท่านั้น ห้ามใส่ในโค้ด)
- API permissions: Microsoft Graph → `openid`, `email`, `profile` (Delegated) แล้วกด Grant admin consent
- Token configuration → Add optional claim → ID → เลือก `email` (Supabase ต้องใช้อีเมลจาก token)

**B. ตั้งค่าใน Supabase** (Authentication → Sign In / Providers → **Azure**)
- Enable, ใส่ Client ID และ Secret Value จากข้อ A
- Azure Tenant URL: `https://login.microsoftonline.com/<tenant-id>`

**C. Authentication → URL Configuration**
- Site URL: `https://turtletwentythree.github.io/Turtle23-Tracking-Contracts/`
- Redirect URLs: เพิ่ม URL เดียวกัน (และ `http://localhost:8000/` ถ้าทดสอบในเครื่อง)

## กำหนดสิทธิ์หลังบ้านหลังผูก Microsoft Entra

ทุกครั้งที่ผู้ใช้เข้าระบบด้วย Microsoft ฐานข้อมูล (trigger ใน `003_entra_roles.sql`) จะตัดสิน Level ตามลำดับนี้
1. **Entra App Role**: ถ้า token มี App Role (หรือ Group ID) ที่อยู่ในตาราง `entra_role_mappings` จะใช้ Level สูงสุดที่จับคู่ได้ และบันทึกว่า "Managed by = entra" ถ้าภายหลังถอด role ใน Entra ผู้ใช้จะกลับไปเป็นค่าเริ่มต้นของโดเมน
2. **Admin กำหนดเอง**: ถ้า token ไม่มี role ที่จับคู่ไว้ ระบบใช้ Level ที่ Admin ตั้งใน **Admin Tools → Users & Roles** (Managed by = manual)
3. **โดเมนที่อนุญาต**: อีเมลใหม่จากโดเมน `turtle23.com` เริ่มเป็น `viewer` (ตั้งได้ในตาราง `allowed_domains`) อีเมลนอกโดเมนที่ไม่มีทั้ง role และรายชื่อจะถูกปฏิเสธ

ทุกการเพิ่ม เปลี่ยน หรือลบสิทธิ์ ถูกบันทึกในตาราง `access_audit` (ดูได้ที่ **Admin Tools → Change History**) และระบบไม่ยอมให้ระงับหรือลด Admin คนสุดท้าย
สิทธิ์ทั้งหมดบังคับด้วย Row Level Security ในฐานข้อมูล ผู้ใช้แก้ Level ของตัวเองไม่ได้ ตาราง mapping และประวัติเปิดให้เฉพาะ Admin

**ตั้ง App Role ใน Entra** (ทำครั้งเดียว ข้ามได้ถ้าจะให้ Admin กำหนดสิทธิ์ในเว็บอย่างเดียว)
1. Entra → App registrations → `Contract Tracking System` → **App roles → Create app role** สร้าง 4 รายการ (Allowed member types: Users/Groups)

   | Display name | Value | Level |
   |---|---|---|
   | Contract Viewer | `Contract.Viewer` | 1 Viewer |
   | Contract User | `Contract.User` | 2 User |
   | Confidential User | `Contract.Confidential` | 3 Confidential |
   | System Administrator | `Contract.Admin` | 4 Admin |
2. Entra → **Enterprise applications** → `Contract Tracking System` → **Users and groups → Add user/group** แล้วเลือกคนหรือกลุ่มพร้อม role
3. (ถ้าต้องการให้เฉพาะคนที่ได้ role เข้าได้) Enterprise applications → Properties → **Assignment required? = Yes**
4. ให้ผู้ใช้ออกแล้วเข้าระบบใหม่ Level จะอัปเดตทันทีที่เข้าระบบ

ถ้าจะใช้ Security Group แทน App Role: Token configuration → Add groups claim แล้วเพิ่ม Group Object ID ลงใน **Admin Tools → Entra Role Mapping**

> ตรวจสอบหลังผูกครั้งแรก: Supabase เก็บ claim เพิ่มเติมของ token ไว้ที่ `auth.users.raw_user_meta_data -> 'custom_claims'` ให้รัน
> `select email, raw_user_meta_data->'custom_claims' from auth.users;` ถ้าไม่เห็น `roles` แปลว่า role ยังไม่ส่งมากับ token
> (ตรวจว่ากำหนด role ให้ผู้ใช้แล้ว) ระหว่างนั้น Admin ยังกำหนดสิทธิ์ในเว็บได้ตามปกติ

## Deploy ขึ้น GitHub Pages

1. Push โค้ดขึ้น repo (branch `main`)
2. **Settings → Secrets and variables → Actions** เพิ่ม secrets:
   - `SUPABASE_URL` เช่น `https://xxxx.supabase.co`
   - `SUPABASE_ANON_KEY` (Project Settings → API → anon public key)
3. **Settings → Pages → Source: GitHub Actions**
4. ทุกครั้งที่ push ขึ้น `main` workflow จะเขียน `assets/config.js` จาก secrets แล้ว deploy ให้อัตโนมัติ
   ไม่ต้อง commit key ลง repo และห้ามใส่ `service_role` key ในหน้าเว็บเด็ดขาด

## รันในเครื่อง

```bash
python3 -m http.server 8000
# เปิด http://localhost:8000
```
ถ้า `assets/config.js` ว่าง จะเข้าโหมดสาธิต (ยังไม่มี Microsoft 365): กดบัญชี `viewer@` / `user@` / `confidential@` / `admin@turtle23.com` หรือพิมพ์อีเมลใดก็ได้ที่อยู่ใน Users & Roles (รหัสผ่าน `demo1234`) ข้อมูลเก็บใน localStorage ของเบราว์เซอร์

## กติกาสถานะ

- **Days Used** = วันทำการตั้งแต่ Add Case ถึงวันนี้ (หรือวันปิดเคส)
- **Days on Hand** = วันทำการที่ค้างอยู่กับ Station Owner ปัจจุบัน
- **Balance** = Total SLA − Days Used
- **R = Overdue** เมื่อ Balance ติดลบหรือเลย Due Date · **Y = Delayed** เมื่อเหลือ ≤ 20% ของ SLA (อย่างน้อย 2 วัน) · **G = On Track**

## นำข้อมูล Production ล่าสุดเข้าระบบ

1. (ครั้งแรกครั้งเดียว) รัน `supabase/migrations/005_snapshot_import.sql` ใน Supabase SQL Editor
2. เข้าเว็บด้วยบัญชี Admin → **Admin Tools** → **Import Production Snapshot** → เลือกไฟล์ `production_snapshot.json`
3. ตรวจจำนวนแถวที่แสดง แล้วกด **Import to database** (กดยืนยันอีกครั้ง)

การนำเข้าทำในฐานข้อมูลครั้งเดียวแบบทั้งหมดหรือไม่มีเลย: สัญญาที่มี Contract ID เดิมถูกอัปเดต ที่ไม่มีถูกเพิ่ม ไม่ลบข้อมูลเดิม
ระดับสิทธิ์ใน Users & Roles ไม่เปลี่ยน คนใน People Master ที่ยังไม่มีบัญชีจะถูกเพิ่มเป็น Viewer
ไฟล์ข้อมูลจริงห้าม commit ลง repo นี้ (repo เป็น public)
