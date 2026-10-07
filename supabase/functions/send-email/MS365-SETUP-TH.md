# ส่งอีเมลด้วย Microsoft 365 (ไม่ต้องแก้ DNS) ทีละขั้น บน Mac

ใช้แทน Resend ได้ทั้งหมด ไฟล์แนบรวมได้ถึง 15 MB เหมือนกัน อีเมลออกจากกล่องจดหมายบริษัท เช่น `contract@turtle23.com`
และมีสำเนาอยู่ใน Sent Items ของกล่องนั้น
**ขั้น 1–5 ต้องทำโดย Microsoft 365 / Entra Global Admin** (หรือ Privileged Role Admin สำหรับการกด Admin consent)
ห้ามส่งค่า Client secret มาในแชต

---

## ส่วน A: Microsoft 365 Admin

**1. สร้างกล่องจดหมายผู้ส่ง (ถ้ายังไม่มี)**
- https://admin.exchange.microsoft.com → **Recipients → Mailboxes → Add a shared mailbox**
- Display name `T23 Contract Tracking` · Email `contract@turtle23.com` → **Create**
- Shared mailbox ไม่ต้องใช้ License ชื่อที่ตั้งตรงนี้คือชื่อผู้ส่งที่ผู้รับเห็น

**2. ลงทะเบียน App**
- https://entra.microsoft.com → **Applications → App registrations → New registration**
- Name `T23 Contract Tracking Mail` · Supported account types: **Accounts in this organizational directory only** · Redirect URI เว้นว่าง → **Register**
- หน้า Overview จดค่า 2 ค่า: **Application (client) ID** และ **Directory (tenant) ID**

**3. ให้สิทธิ์ส่งอีเมล**
- ในแอปเดิม → **API permissions → Add a permission → Microsoft Graph → Application permissions**
- ค้น `Mail.Send` → ติ๊ก → **Add permissions**
- กด **Grant admin consent for (ชื่อบริษัท)** → **Yes**
- ที่ควรเห็น: แถว Mail.Send ขึ้น ✅ **Granted for ...**
- (ถ้ามี `User.Read` แบบ Delegated ติดมาโดยอัตโนมัติ ลบทิ้งได้)

**4. สร้าง Client secret**
- **Certificates & secrets → Client secrets → New client secret** · Description `supabase` · Expires **24 months** → **Add**
- คัดลอกช่อง **Value** (ไม่ใช่ Secret ID) ทันที ค่านี้โชว์ครั้งเดียว
- ตั้งเตือนในปฏิทินก่อนหมดอายุ 2 ปี เพื่อสร้างค่าใหม่แล้วใส่ใน Supabase (ขั้น 7)

**5. (แนะนำ) จำกัดให้ App ส่งได้จากกล่อง contract@ อย่างเดียว**
ถ้าไม่ทำ App นี้มีสิทธิ์ส่งในนามทุกคนในบริษัท ซึ่งระบบเราไม่ใช้ แต่ควรปิดไว้
- Exchange admin center → **Recipients → Groups → Add a group → Mail-enabled security**
  ชื่อ `T23 Contract Mail Senders` · อีเมล `t23-mail-senders@turtle23.com` · เพิ่มสมาชิก `contract@turtle23.com`
- Terminal บน Mac:
```bash
brew install --cask powershell
pwsh
```
- ใน PowerShell (แทน `<CLIENT_ID>` ด้วยค่าจากขั้น 2):
```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline
New-ApplicationAccessPolicy -AppId <CLIENT_ID> -PolicyScopeGroupId t23-mail-senders@turtle23.com -AccessRight RestrictAccess -Description "T23 Contract Tracking: send as contract@ only"
Test-ApplicationAccessPolicy -Identity contract@turtle23.com -AppId <CLIENT_ID>
```
- ที่ควรเห็นบรรทัดสุดท้าย: `AccessCheckResult : Granted` (ถ้าลองกับอีเมลคนอื่นต้องเป็น `Denied`)
- นโยบายอาจใช้เวลาสักพัก (ถึง 1 ชั่วโมง) กว่าจะมีผล

---

## ส่วน B: Supabase (ทำต่อจากคู่มือ EMAIL-SETUP ขั้น 1 และ 6–8 คือ SQL, ติดตั้ง CLI, clone, login, link)

**6. ดึงโค้ดล่าสุด**
```bash
cd ~/Downloads/Turtle23-Tracking-Contracts && git pull
```

**7. ใส่ค่าลับ (แทน `<...>` ด้วยค่าจากขั้น 2 และ 4)**
```bash
supabase secrets set EMAIL_PROVIDER=graph
supabase secrets set MS_TENANT_ID=<DIRECTORY_TENANT_ID>
supabase secrets set MS_CLIENT_ID=<APPLICATION_CLIENT_ID>
supabase secrets set MS_CLIENT_SECRET=<CLIENT_SECRET_VALUE>
supabase secrets set MS_SENDER=contract@turtle23.com
supabase secrets set EMAIL_FROM="T23 Contract Tracking <contract@turtle23.com>"
supabase secrets set SITE_URL=https://turtletwentythree.github.io/Turtle23-Tracking-Contracts
supabase secrets set ALLOWED_ORIGIN=https://turtletwentythree.github.io
```
- ที่ควรเห็น: `Finished supabase secrets set.` ทุกบรรทัด
- ถ้าเคยใส่ `RESEND_API_KEY` ไว้ ปล่อยไว้ได้ ระบบใช้ตาม `EMAIL_PROVIDER`

**8. Deploy**
```bash
supabase functions deploy send-email --no-verify-jwt
```
- ที่ควรเห็น: `Deployed Functions on project zxxfqcppztlmdaqqijhc: send-email`

**9. ทดสอบ**
- เว็บ → Cmd+Shift+R → Update Status แนบไฟล์ → ส่งหาตัวเอง
- ที่ควรเห็น: `Sent / ส่งแล้ว` อีเมลมาจาก T23 Contract Tracking และมีสำเนาใน Sent Items ของ contract@
- ถ้า Send Failed ดูข้อความ:
  - `Microsoft sign-in 401/400` → Tenant ID, Client ID หรือ Client secret ผิด (ใช้ช่อง Value)
  - `Microsoft Graph ... 403 ... Access is denied` → ยังไม่ได้กด Admin consent (ขั้น 3) หรือกล่องผู้ส่งไม่อยู่ในกลุ่มของขั้น 5
  - `... 404 ...` → อีเมลใน `MS_SENDER` ไม่มีอยู่จริง

## สลับกลับไป Resend ภายหลัง
`supabase secrets set EMAIL_PROVIDER=resend` แล้ว deploy ใหม่ (ต้องมี RESEND_API_KEY และโดเมน Verified)
