# ตั้งค่าไฟล์แนบและอีเมล (ทำครั้งเดียว บน Mac) ไม่ใช้ Google Drive และไม่ใช้ Apps Script

- **ไฟล์แนบ** เก็บใน Supabase Storage (bucket ส่วนตัว `attachments`) เปิดได้เฉพาะคนที่มีสิทธิ์เห็นสัญญานั้น ลิงก์เปิดไฟล์หมดอายุใน 5 นาที
- **อีเมล** ส่งจาก Supabase Edge Function ชื่อ `send-email` ผ่านผู้ให้บริการอีเมล (ค่าเริ่มต้น: Resend)
  ฟังก์ชันตรวจว่าผู้ส่งล็อกอินและเป็น Level 2 ขึ้นไป ตรวจ To/CC/ไฟล์ซ้ำอีกรอบ ดึงไฟล์จาก Storage ในสิทธิ์ของผู้ส่งเอง
  และจดทุกฉบับใน `email_outbox` ตาม requestId กดส่งซ้ำก็ไม่ส่งสองฉบับ
- ไฟล์รวมไม่เกิน 15 MB แนบไปกับอีเมลเลย ถ้าเกินจะส่งเป็นลิงก์เข้าหน้าสัญญานั้นในระบบแทน
- คีย์ของผู้ให้บริการอีเมลเก็บใน Supabase Secrets เท่านั้น ไม่อยู่ในเว็บหรือใน GitHub

## 1. รัน SQL (Supabase → SQL Editor → New query → วาง → Run ทีละไฟล์)
1. `supabase/migrations/010_email_attachments.sql`
2. `supabase/migrations/011_storage_attachments.sql` → เมนู **Storage** ต้องเห็น bucket `attachments` เป็น Private (ถึงตรงนี้แนบไฟล์ได้แล้ว)
3. `supabase/migrations/012_email_outbox.sql`

## 2. สมัคร Resend และยืนยันโดเมน turtle23.com
1. สมัครที่ https://resend.com → **Domains** → **Add Domain** ใส่ `turtle23.com` (หรือโดเมนย่อย เช่น `mail.turtle23.com` จะไม่กระทบอีเมลบริษัทเดิม)
2. Resend จะแสดงระเบียน DNS (MX, TXT สำหรับ SPF และ DKIM) ส่งรายการนี้ให้ผู้ดูแล DNS ของบริษัทเพิ่มตามนั้นทุกบรรทัด
3. รอจนสถานะโดเมนเป็น **Verified**
4. **API Keys** → **Create API Key** (Permission: Sending access) → คัดลอกเก็บไว้ ห้ามวางในแชตหรือใน GitHub

## 3. ติดตั้ง Supabase CLI และเชื่อมโปรเจกต์ (Terminal บน Mac)
```bash
brew install supabase/tap/supabase
cd ~/Downloads && git clone https://github.com/turtletwentythree/Turtle23-Tracking-Contracts.git
cd Turtle23-Tracking-Contracts
supabase login
supabase link --project-ref <PROJECT_REF>
```
`<PROJECT_REF>` คือส่วนหน้าของ URL โปรเจกต์ เช่น `https://abcd1234.supabase.co` → `abcd1234`
(ถ้า clone ไว้แล้ว ใช้ `git pull` แทน)

## 4. ใส่ Secrets
```bash
supabase secrets set RESEND_API_KEY=<คีย์จากข้อ 2>
supabase secrets set EMAIL_FROM="T23 Contract Tracking <contract@turtle23.com>"
supabase secrets set SITE_URL=https://turtletwentythree.github.io/Turtle23-Tracking-Contracts
supabase secrets set ALLOWED_ORIGIN=https://turtletwentythree.github.io
```
`EMAIL_FROM` ต้องใช้โดเมนที่ Verified ในข้อ 2

## 5. Deploy ฟังก์ชัน
```bash
supabase functions deploy send-email --no-verify-jwt
```
(`--no-verify-jwt` เพราะฟังก์ชันตรวจการล็อกอินเองข้างใน รองรับคีย์แบบใหม่ sb_publishable ด้วย)
ตรวจ: Supabase → **Edge Functions** ต้องเห็น `send-email` · ลองส่งอีเมลจากเว็บ แล้วดู **Logs** ของฟังก์ชัน และตาราง `email_outbox`

## ใช้ Microsoft 365 ส่งแทน Resend (ไม่ต้องแก้ DNS)
ดูขั้นตอนเต็มใน `MS365-SETUP-TH.md` ในโฟลเดอร์นี้ (ต้องให้ Microsoft 365 Admin สร้าง Entra App ที่มีสิทธิ์ Mail.Send) แล้วตั้ง
`EMAIL_PROVIDER=graph`, `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SENDER` แทน `RESEND_API_KEY`
ไฟล์แนบรวมได้ถึง 15 MB เหมือน Resend (ไฟล์ใหญ่ส่งผ่าน upload session ของ Microsoft)

## ไม่ต้องใช้แล้ว
- GitHub Secret `APPS_SCRIPT_URL` ลบได้ (GitHub → Settings → Secrets and variables → Actions)
- โปรเจกต์ Apps Script เดิม (ถ้าเคยสร้าง) ลบหรือปิด Deployment ได้
