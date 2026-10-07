# ตั้งค่าไฟล์แนบและอีเมล (ทำครั้งเดียว บน Mac) ไม่ใช้ Google Drive

- **ไฟล์แนบ** เก็บใน Supabase Storage (bucket ส่วนตัวชื่อ `attachments`) เปิดได้เฉพาะคนที่ล็อกอินและมีสิทธิ์เห็นสัญญานั้น
  ลิงก์เปิดไฟล์สร้างตอนกด และหมดอายุใน 5 นาที
- **อีเมล** ส่งผ่าน Gmail โดย Apps Script ในไฟล์ `Code.gs` (ไม่ใช้ Drive) อีเมลออกจากบัญชี Google ที่เป็นคน Deploy
  ไฟล์รวมไม่เกิน 15 MB แนบไปกับอีเมลเลย ถ้าเกินจะส่งเป็นลิงก์เข้าระบบแทน

## 1. รัน SQL 010 และ 011
Supabase → SQL Editor → New query → วางไฟล์ `supabase/migrations/010_email_attachments.sql` → Run
แล้ว New query อีกครั้ง → วาง `supabase/migrations/011_storage_attachments.sql` → Run
ตรวจ: เมนู **Storage** ต้องเห็น bucket `attachments` ขึ้นว่า Private (ถึงตรงนี้แนบไฟล์ได้แล้ว แม้ยังไม่ตั้งค่าอีเมล)

## 2. สร้างสคริปต์อีเมล
1. เปิด https://script.google.com → **New project** ตั้งชื่อ `T23 Contract Tracking Email`
2. ลบโค้ดเดิมใน `Code.gs` ทิ้ง เปิดไฟล์ `apps-script/Code.gs` ใน GitHub กด **Raw** → Cmd+A, Cmd+C แล้ววาง Cmd+V → Cmd+S
3. รูปฟันเฟือง **Project Settings** → เลื่อนลงไปที่ **Script Properties** → **Add script property** ใส่ทีละค่า:
   | Property | Value |
   |---|---|
   | `SUPABASE_URL` | URL โปรเจกต์ Supabase (เหมือน GitHub Secret ชื่อเดียวกัน) |
   | `SUPABASE_ANON_KEY` | Publishable key (sb_publishable_…) ห้ามใช้ Secret key |
   | `SENDER_NAME` | (ไม่บังคับ) ชื่อผู้ส่ง เช่น `T23 Contract Tracking` |
   กด **Save script properties**
4. กลับไปหน้า Editor เลือกฟังก์ชัน `setupCheck` ที่แถบด้านบน → **Run** → **Review permissions** → เลือกบัญชี → **Allow**
   ใน Execution log ต้องเห็น `Supabase reachable: HTTP 200` และอีเมลผู้ส่ง (สคริปต์ขอสิทธิ์แค่ส่งอีเมลและเรียก Supabase ไม่ขอสิทธิ์ Drive)

## 3. Deploy เป็น Web app
1. ปุ่ม **Deploy** (มุมขวาบน) → **New deployment** → รูปฟันเฟือง เลือก **Web app**
2. Execute as: **Me** · Who has access: **Anyone** (ระบบตรวจสิทธิ์เองว่าเป็นผู้ใช้ Level 2 ขึ้นไปที่ล็อกอินอยู่)
3. กด **Deploy** แล้วคัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)

## 4. ใส่ URL ให้เว็บ
1. GitHub → repo → Settings → Secrets and variables → Actions → **New repository secret**
2. Name: `APPS_SCRIPT_URL` · Secret: URL จากข้อ 3 → **Add secret**
3. Actions → Deploy to GitHub Pages → **Run workflow** รอจนเขียว แล้วเปิดเว็บกด Cmd+Shift+R

## ถ้าเคยตั้งค่าแบบ Google Drive ไว้แล้ว
วางโค้ด `Code.gs` ใหม่ทับ → Save → ลบ Script Property `ATTACHMENT_FOLDER_ID` และ `SHARE_MODE` ได้ → Run `setupCheck` อีกครั้ง
→ Deploy → **Manage deployments** → ดินสอ → Version: **New version** → Deploy (URL เดิมใช้ต่อได้ ไม่ต้องแก้ Secret)

## แก้โค้ดสคริปต์ภายหลัง
วางโค้ดใหม่ → Save → Deploy → **Manage deployments** → ดินสอ → Version: **New version** → Deploy

## ไม่อยากใช้ Gmail / Apps Script
ใช้บริการส่งอีเมลแบบ API (เช่น Resend หรือ SendGrid) ผ่าน Supabase Edge Function แทนได้ ต้องมีโดเมนอีเมลบริษัทที่ยืนยันกับผู้ให้บริการ
ส่วนไฟล์แนบใน Supabase Storage ไม่ต้องเปลี่ยน
