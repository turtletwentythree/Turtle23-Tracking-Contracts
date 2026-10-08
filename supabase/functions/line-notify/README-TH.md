# LINE Notification (Edge Function `line-notify`)

แจ้งเตือนสัญญา Y=Delayed และ R=Overdue เข้ากลุ่ม LINE **T23_Tracking Contract**
ใช้กฎ SLA ชุดเดียวกับ Dashboard (`supabase/functions/_shared/sla-engine.js`) จำนวน Y + R ใน LINE จึงตรงกับ Dashboard เสมอ

- ส่งอัตโนมัติ จันทร์–ศุกร์ 09:30 เวลาไทย (pg_cron) สูงสุด 1 ครั้งต่อสัญญาต่อวัน
- Automatic เริ่มต้นเป็น **Off** จะไม่ส่งอะไรจนกว่า Admin เปิดใน Admin Tools > LINE Notification
- Admin กด Send Now ส่งซ้ำได้ (กดสองครั้งเพื่อยืนยัน ปุ่มล็อกระหว่างส่ง)
- สัญญาลับ แสดงเฉพาะ Contract ID ชื่อสัญญา คู่สัญญา และเหตุผลถูกซ่อน
- Token อยู่ใน Supabase secrets เท่านั้น ไม่อยู่ในเว็บหรือใน repo

## ติดตั้ง

1. Supabase > SQL Editor: รัน `supabase/migrations/014_line_notify.sql`
2. ตั้ง secrets (ใช้ค่าเดิมจาก Apps Script ได้: Apps Script > Project Settings > Script Properties หรือจาก LINE Developers Console > Messaging API)
   ```
   supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=... LINE_GROUP_ID=... LINE_WEBHOOK_KEY=...
   ```
   หรือ Supabase > Edge Functions > Secrets > Add new secret ทีละตัว
3. Deploy
   ```
   supabase functions deploy line-notify --no-verify-jwt
   ```
   ไม่มี CLI: `python3 supabase/functions/line-notify/make-single-file.py line-notify-single-file.ts` แล้ววางไฟล์นั้นใน
   Supabase > Edge Functions > Deploy a new function > Via Editor ตั้งชื่อ `line-notify` > Deploy แล้วปิด Verify JWT ในหน้า Details ของฟังก์ชัน
4. ตั้งเวลา 09:30 (SQL Editor) แทน `<PROJECT_REF>` ด้วย Project ref ของ Supabase
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.unschedule(jobid) from cron.job where jobname = 'line-notify-0930';
   select cron.schedule('line-notify-0930', '30 2 * * 1-5', $$
     select net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/line-notify',
       headers := jsonb_build_object('Content-Type', 'application/json',
                  'x-cron-key', (select cron_key from public.line_settings where id = 1)),
       body := '{"mode":"scheduled"}'::jsonb,
       timeout_milliseconds := 60000);
   $$);
   ```
   (02:30 UTC = 09:30 เวลาไทย) ถ้า Automatic ยัง Off งานนี้จะข้ามไปเฉย ๆ ไม่ส่ง
5. เว็บ > Admin Tools > LINE Notification > **Refresh Preview** ตรวจว่า Token / Group พร้อม และ Queue ตรงกับ Dashboard
6. เมื่อพร้อมจริง: ปิด Trigger 09:30 ของ Apps Script เดิมก่อน (กันส่งซ้ำ 2 ระบบ) แล้วค่อยเปิด Automatic

## Webhook (ไม่จำเป็น ถ้าตั้ง LINE_GROUP_ID แล้ว)

ใช้เมื่อต้องการให้ระบบจับ Group ID เอง: LINE Developers Console > Messaging API > Webhook URL
```
https://<PROJECT_REF>.supabase.co/functions/v1/line-notify?key=<LINE_WEBHOOK_KEY>
```
เปิด Use webhook แล้วพิมพ์ข้อความในกลุ่ม 1 ครั้ง (การเปลี่ยน URL นี้จะทำให้ Webhook ของ Apps Script เดิมหยุดรับ)

## Requests

| ใคร | body | ตรวจสิทธิ์ |
|---|---|---|
| Admin Tools | `{"mode":"status" \| "preview" \| "send" \| "setAuto", "enabled"}` | session ที่ login, Level 4-5 |
| pg_cron | `{"mode":"scheduled"}` | header `x-cron-key` = `line_settings.cron_key` |
| LINE | webhook events | `?key=` = `LINE_WEBHOOK_KEY` |

`preview` ไม่เรียก LINE เลย (dry run)
