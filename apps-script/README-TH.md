# ตั้งค่า Apps Script สำหรับแนบไฟล์และส่งอีเมล (ทำครั้งเดียว บน Mac)

เว็บบน GitHub Pages ไม่เขียนไฟล์ลง Google Drive และไม่ส่งอีเมลเอง แต่ส่งให้ Apps Script ในไฟล์ `Code.gs` ทำแทน
อีเมลจะส่งออกจากบัญชี Google ที่เป็นคน Deploy สคริปต์ ใช้บัญชีบริษัท (บัญชีเดียวกับที่ใช้กับแอปเดิมก็ได้)

## 1. รัน SQL 010
Supabase → SQL Editor → New query → วางไฟล์ `supabase/migrations/010_email_attachments.sql` → Run

## 2. เตรียมโฟลเดอร์ใน Google Drive
1. เปิด drive.google.com สร้างโฟลเดอร์ เช่น `Contract Attachments` (หรือใช้โฟลเดอร์เดิมของแอปเก่า)
2. เปิดโฟลเดอร์ ดู URL ด้านบน ส่วนหลัง `/folders/` คือ **Folder ID** คัดลอกเก็บไว้

## 3. สร้างสคริปต์
1. เปิด https://script.google.com → **New project** ตั้งชื่อ `T23 Contract Tracking Email`
2. ลบโค้ดเดิมใน `Code.gs` ทิ้ง เปิดไฟล์ `apps-script/Code.gs` ใน GitHub กด **Raw** → Cmd+A, Cmd+C แล้ววาง Cmd+V → Cmd+S
3. รูปฟันเฟือง **Project Settings** → เลื่อนลงไปที่ **Script Properties** → **Add script property** ใส่ทีละค่า:
   | Property | Value |
   |---|---|
   | `SUPABASE_URL` | URL โปรเจกต์ Supabase (เหมือน GitHub Secret ชื่อเดียวกัน) |
   | `SUPABASE_ANON_KEY` | Publishable key (sb_publishable_…) ห้ามใช้ Secret key |
   | `ATTACHMENT_FOLDER_ID` | Folder ID จากข้อ 2 |
   | `SHARE_MODE` | `recipients` (ผู้รับ To/CC เปิดไฟล์ได้) หรือ `domain` (ทุกคนในโดเมน Google Workspace ของบริษัท) |
   กด **Save script properties**
4. กลับไปหน้า Editor เลือกฟังก์ชัน `setupCheck` ที่แถบด้านบน → **Run** → **Review permissions** → เลือกบัญชี → **Allow**
   ใน Execution log ต้องเห็นชื่อโฟลเดอร์ `Supabase reachable: HTTP 200` และอีเมลผู้ส่ง

## 4. Deploy เป็น Web app
1. ปุ่ม **Deploy** (มุมขวาบน) → **New deployment** → รูปฟันเฟือง เลือก **Web app**
2. Execute as: **Me** · Who has access: **Anyone** (ระบบตรวจสิทธิ์เองว่าเป็นผู้ใช้ Level 2 ขึ้นไปที่ล็อกอินอยู่)
3. กด **Deploy** แล้วคัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)

## 5. ใส่ URL ให้เว็บ
1. GitHub → repo → Settings → Secrets and variables → Actions → **New repository secret**
2. Name: `APPS_SCRIPT_URL` · Secret: URL จากข้อ 4 → **Add secret**
3. Actions → Deploy to GitHub Pages → **Run workflow** รอจนเขียว แล้วเปิดเว็บกด Cmd+Shift+R

## แก้โค้ดสคริปต์ภายหลัง
วางโค้ดใหม่ → Save → Deploy → **Manage deployments** → ดินสอ → Version: **New version** → Deploy (URL เดิมใช้ต่อได้ ไม่ต้องแก้ Secret)
