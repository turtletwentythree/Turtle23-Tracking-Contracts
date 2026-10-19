# user-password: บัญชีอีเมล + รหัสผ่านสำหรับบุคคลภายนอก

- Admin (Level 4-5) ตั้งหรือรีเซ็ตรหัสผ่านได้ที่ Admin Tools > Users & Roles > ปุ่ม **🔑 รหัสผ่าน** ท้ายแถว
- ปุ่มแสดงเฉพาะแถวที่ Active, Level 1-3 และอีเมลไม่ใช่ @turtle23.com (พนักงานเข้าด้วย Microsoft 365 เท่านั้น)
- สิทธิ์ของผู้ใช้มาจาก Level ใน Users & Roles เหมือนคนอื่น ปิด Active = ระงับการเข้าทันที
- สุ่มรหัสผ่านชั่วคราว 12 ตัว (แสดงครั้งเดียว) หรือกำหนดเอง (อย่างน้อย 10 ตัว มีตัวอักษรและตัวเลข)
- เข้าครั้งแรก (และหลังรีเซ็ตทุกครั้ง) ผู้ใช้ต้องตั้งรหัสผ่านใหม่เองก่อนใช้งาน · เปลี่ยนเองได้ที่เมนูโปรไฟล์ > เปลี่ยนรหัสผ่าน
- ทุกครั้งที่ตั้ง/รีเซ็ต บันทึกใน Change History (access_audit: password created / password reset) ไม่เก็บตัวรหัสผ่าน
- ไม่ต้องรัน SQL เพิ่ม และไม่ต้องตั้ง secret เพิ่ม (ใช้ SUPABASE_URL / service key ที่ Supabase ใส่ให้ฟังก์ชันอยู่แล้ว)

## ติดตั้ง

1. Supabase > Edge Functions > Deploy a new function > Via Editor ชื่อ `user-password`
   วางไฟล์ที่ได้จาก `python3 supabase/functions/user-password/make-single-file.py user-password-single-file.ts` แล้ว Deploy
   จากนั้นปิด **Verify JWT** ของฟังก์ชันนี้ (หรือ CLI: `supabase functions deploy user-password --no-verify-jwt`)
2. Supabase > Authentication > Sign In / Providers > **Email** ต้องเปิด (Enabled) และ **Confirm email** ต้องเปิดไว้
   (กันคนสมัครเองด้วยอีเมลคนอื่น บัญชีที่ Admin สร้างถูกยืนยันให้แล้ว)
3. หน้า Login แสดงช่อง Email / Password เมื่อ GitHub repository variable `ALLOW_PASSWORD_LOGIN` ไม่ได้ตั้งเป็น `false`

## ข้อจำกัด

- ไม่มี MFA (ต่างจาก Microsoft 365) จึงจำกัดไว้ที่ Level 1-3
- ถ้าภายหลังเปลี่ยน Level ของคนนี้เป็น 4-5 รหัสผ่านเดิมยังเข้าได้ ควรเชิญเป็น Entra Guest แทนก่อนให้สิทธิ์ Admin
