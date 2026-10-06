# คู่มือตั้งค่าทีละคลิก (Contract Tracking System)

ทำตามลำดับ ทีละขั้น ถ้าติดตรงไหนให้แคปหน้าจอส่งมาในแชทได้เลย

ค่าที่ใช้บ่อย
- Repo: https://github.com/turtletwentythree/Turtle23-Tracking-Contracts
- Supabase: https://supabase.com/dashboard/project/zxxfqcppztlmdaqqijhc
- ลิงก์เว็บ: https://turtletwentythree.github.io/Turtle23-Tracking-Contracts/
- Callback ของ Supabase: https://zxxfqcppztlmdaqqijhc.supabase.co/auth/v1/callback

---

## ขั้นที่ 1: เปิด GitHub Pages
1. เปิด https://github.com/turtletwentythree/Turtle23-Tracking-Contracts
2. กดแท็บ **Settings** (แถบบนสุด ขวามือ รูปฟันเฟือง)
3. เมนูซ้าย กด **Pages**
4. หัวข้อ **Build and deployment** → ช่อง **Source** กดลูกศร เลือก **GitHub Actions**
5. ไม่ต้องกดอะไรต่อ ระบบบันทึกให้อัตโนมัติ

## ขั้นที่ 2: รัน SQL ใน Supabase
1. เปิด https://github.com/turtletwentythree/Turtle23-Tracking-Contracts/blob/main/supabase/all_in_one.sql
2. กดปุ่ม **Copy raw file** (ไอคอนสี่เหลี่ยมซ้อนกัน มุมขวาบนของกรอบโค้ด)
3. เปิด https://supabase.com/dashboard/project/zxxfqcppztlmdaqqijhc
4. เมนูซ้าย กด **SQL Editor** (ไอคอน `>_`)
5. กดปุ่ม **+** แล้วเลือก **Create a new snippet** (หรือ **New query**)
6. คลิกในช่องว่าง กด Ctrl+V (Mac: Cmd+V) เพื่อวางโค้ด
7. กดปุ่ม **Run** (มุมขวาล่าง) ต้องขึ้น **Success. No rows returned**
8. กด **+** อีกครั้ง สร้าง query ใหม่ วางคำสั่งนี้ (เปลี่ยนอีเมลและชื่อเป็นของคุณ) แล้วกด **Run**

```sql
insert into public.user_access (email, display_name, role)
values ('อีเมลคุณ@turtle23.com', 'ชื่อคุณ', 'admin')
on conflict (email) do update set role = 'admin', active = true;
```

ถ้าขึ้น error ว่า already exists แปลว่ารันไปแล้ว ข้ามได้

## ขั้นที่ 3: หาค่า URL และ Key ของ Supabase
1. ในหน้า Supabase เมนูซ้ายล่าง กด **Project Settings** (รูปฟันเฟือง)
2. กด **API Keys**
3. คัดลอกค่า **anon public** (ถ้ามีแท็บ Legacy ให้ดูในแท็บ **Legacy API Keys**) หรือค่า **Publishable key** (ขึ้นต้นด้วย `sb_publishable_`) อย่างใดอย่างหนึ่ง
4. ห้ามใช้ค่า **service_role** หรือ **Secret key**
5. URL คือ `https://zxxfqcppztlmdaqqijhc.supabase.co`

## ขั้นที่ 4: ใส่ GitHub Secrets
1. กลับไปที่ repo → **Settings**
2. เมนูซ้าย กด **Secrets and variables** → **Actions**
3. กดปุ่มสีเขียว **New repository secret**
4. ช่อง **Name** พิมพ์ `SUPABASE_URL` ช่อง **Secret** วาง `https://zxxfqcppztlmdaqqijhc.supabase.co` แล้วกด **Add secret**
5. กด **New repository secret** อีกครั้ง
6. ช่อง **Name** พิมพ์ `SUPABASE_ANON_KEY` ช่อง **Secret** วางค่าจากขั้นที่ 3 แล้วกด **Add secret**

## ขั้นที่ 5: สั่ง Deploy
1. กดแท็บ **Actions** (แถบบนสุดของ repo)
2. เมนูซ้าย กด **Deploy to GitHub Pages**
3. ด้านขวา กดปุ่ม **Run workflow** แล้วกดปุ่มสีเขียว **Run workflow** อีกครั้ง
4. รอประมาณ 1 นาที รายการบนสุดจะขึ้นเครื่องหมายถูกสีเขียว
5. เปิด https://turtletwentythree.github.io/Turtle23-Tracking-Contracts/ (ถ้าเห็นปุ่มบัญชีทดลอง แปลว่า secrets ยังไม่เข้า ให้เช็กขั้นที่ 4)

## ขั้นที่ 6: ตั้งลิงก์เว็บใน Supabase
1. Supabase เมนูซ้าย กด **Authentication**
2. กด **URL Configuration**
3. ช่อง **Site URL** วาง `https://turtletwentythree.github.io/Turtle23-Tracking-Contracts/` แล้วกด **Save changes**
4. หัวข้อ **Redirect URLs** กด **Add URL** วางลิงก์เดียวกัน แล้วกด **Save URLs**

## ขั้นที่ 7: สร้างแอปใน Microsoft Entra (ต้องใช้บัญชี Admin ของ Microsoft 365)
1. เปิด https://entra.microsoft.com
2. เมนูซ้าย **Entra ID** (หรือ **Identity**) → **App registrations**
3. กด **+ New registration**
4. **Name**: `Contract Tracking System`
5. **Supported account types**: เลือก **Accounts in this organizational directory only**
6. **Redirect URI**: ช่องซ้ายเลือก **Web** ช่องขวาวาง `https://zxxfqcppztlmdaqqijhc.supabase.co/auth/v1/callback`
7. กด **Register**
8. หน้า **Overview** คัดลอกเก็บไว้ 2 ค่า: **Application (client) ID** และ **Directory (tenant) ID**
9. เมนูซ้าย **Certificates & secrets** → แท็บ **Client secrets** → **+ New client secret** → กด **Add**
10. คัดลอกค่าในคอลัมน์ **Value** ทันที (ออกจากหน้านี้แล้วจะดูไม่ได้อีก)
11. เมนูซ้าย **Token configuration** → **+ Add optional claim** → เลือก **ID** → ติ๊ก **email** → **Add** (ถ้ามีถาม ให้ติ๊กเปิดสิทธิ์ Microsoft Graph email แล้วกด Add)

## ขั้นที่ 8: เปิด Microsoft ใน Supabase
1. Supabase → **Authentication** → **Sign In / Providers**
2. เลื่อนหา **Azure** แล้วกดเปิด
3. เปิดสวิตช์ **Enable Sign in with Azure**
4. **Application (client) ID**: วางค่าจากขั้นที่ 7 ข้อ 8
5. **Secret Value**: วางค่าจากขั้นที่ 7 ข้อ 10
6. **Azure Tenant URL**: `https://login.microsoftonline.com/` ตามด้วย Directory (tenant) ID
7. กด **Save**
8. เปิดเว็บ พิมพ์อีเมลที่ตั้งเป็น Admin ในขั้นที่ 2 (เช่น name@turtle23.com) กด **Sign in with Microsoft 365** แล้วใส่รหัสผ่านในหน้า Microsoft ของ Turtle23

## ขั้นที่ 9 (ทำทีหลังได้): ให้สิทธิ์ผ่าน Entra
ข้ามได้ถ้าจะกำหนดสิทธิ์ในเว็บ (Admin Tools → Users & Roles) อย่างเดียว
1. Entra → **App registrations** → `Contract Tracking System` → **App roles** → **+ Create app role**
2. สร้าง 4 รายการ (**Allowed member types** เลือก **Both**, ติ๊ก **Do you want to enable this app role?**)
   - Display name `Contract Viewer` / Value `Contract.Viewer`
   - Display name `Contract User` / Value `Contract.User`
   - Display name `Confidential User` / Value `Contract.Confidential`
   - Display name `System Administrator` / Value `Contract.Admin`
3. Entra → **Enterprise applications** → `Contract Tracking System` → **Users and groups** → **+ Add user/group**
4. เลือกคน → เลือก role → **Assign**
5. ผู้ใช้ออกจากระบบแล้วเข้าใหม่ สิทธิ์จะอัปเดตทันที
