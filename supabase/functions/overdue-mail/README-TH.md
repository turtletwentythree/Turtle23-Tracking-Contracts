# overdue-mail: อีเมลเตือนสัญญา R = Overdue ทุกวันจันทร์–ศุกร์

- รายการเดียวกับ Dashboard “5. Longest pending on hand” (สัญญาที่ยังเปิดอยู่และสถานะ R = Overdue วันนี้)
- To = Station Owner (ผู้ถือเคสตอนนี้: To ของ Log ล่าสุด ถ้าไม่มีใช้ Station To ถ้าไม่มีใช้ Contract Owner)
- CC = Contract Owner ถ้าเป็นคนละคน · อีเมลของแต่ละคนมาจาก Master Data > People
- 1 ฉบับต่อคนต่อวัน รวมทุกสัญญาของคนนั้น เรียงวันค้างมากสุดก่อน พร้อมปุ่มลิงก์เข้า User Case Action
- สัญญาลับแสดงเฉพาะ Contract ID
- ส่งผ่านระบบอีเมลเดียวกับ send-email (EMAIL_PROVIDER / EMAIL_FROM และ secrets ของ Microsoft 365) ไม่ต้องตั้ง secret เพิ่ม
- Automatic เริ่มต้นเป็น **Off** · ข้ามเสาร์ อาทิตย์ และวันหยุดใน Holiday Master · ทุกฉบับถูกบันทึกใน email_outbox (kind = overdue_reminder)

## ติดตั้ง

1. Supabase > SQL Editor: รัน `supabase/migrations/019_overdue_mail.sql`
2. Supabase > Edge Functions > Deploy a new function > Via Editor ชื่อ `overdue-mail`
   วางไฟล์ที่ได้จาก `python3 supabase/functions/overdue-mail/make-single-file.py overdue-mail-single-file.ts` แล้ว Deploy
   จากนั้นปิด **Verify JWT** ของฟังก์ชันนี้ (หรือ CLI: `supabase functions deploy overdue-mail --no-verify-jwt`)
3. ตั้งเวลา จันทร์–ศุกร์ 09:00 เวลาไทย (02:00 UTC) ใน SQL Editor:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.unschedule(jobid) from cron.job where jobname = 'overdue-mail-0900';
   select cron.schedule('overdue-mail-0900', '0 2 * * 1-5', $$
     select net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/overdue-mail',
       headers := jsonb_build_object('Content-Type', 'application/json',
                  'x-cron-key', (select cron_key from public.overdue_mail_settings where id = 1)),
       body := '{"mode":"scheduled"}'::jsonb,
       timeout_milliseconds := 120000);
   $$);
   ```
   ถ้า Automatic ยัง Off งานนี้จะข้ามไปเฉย ๆ ไม่ส่ง
4. เว็บ > Admin Tools > Overdue Email > **Refresh Preview** ดูรายชื่อผู้รับและหน้าตาอีเมล (ไม่ส่ง)
5. **ส่งทดสอบถึงตัวเอง** ส่งตัวอย่าง 1 ฉบับถึงอีเมลของ Admin ที่กดเท่านั้น
6. พร้อมแล้วจึงเปิดสวิตช์ “ส่งอีเมลเตือน Overdue อัตโนมัติ 09:00”

## โหมด

| ใคร | body | ตรวจสิทธิ์ |
|---|---|---|
| Admin Tools | `{"mode":"status" \| "preview" \| "sendTest" \| "send" \| "setAuto"}` | session Level 4-5 |
| pg_cron | `{"mode":"scheduled"}` | header `x-cron-key` = `overdue_mail_settings.cron_key` |

`preview` ไม่ส่งอีเมล (dry run) · `sendTest` ส่ง 1 ฉบับถึง Admin เท่านั้น ไม่มี CC
