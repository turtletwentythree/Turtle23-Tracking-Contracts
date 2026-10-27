# Builds overdue-mail as one file for Supabase Dashboard > Edge Functions > Via Editor (no CLI needed).
# Usage: python3 supabase/functions/overdue-mail/make-single-file.py overdue-mail-single-file.ts
import re, sys, os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/'
eng=open(R+'_shared/sla-engine.js').read()
prov=open(R+'send-email/providers.ts').read()
hand=open(R+'overdue-mail/handler.ts').read()
idx=open(R+'overdue-mail/index.ts').read()
unexport=lambda s: re.sub(r'^export (?=(async |function|const|class|interface|type))', '', s, flags=re.M)
prov=re.sub(r'^import type .*\n', '', prov, flags=re.M)
hand=re.sub(r'^import type .*\n', '', hand, flags=re.M)
# types the providers need, defined once here
types='''type Mail = { from: string; to: string; toMore?: string[]; cc: string[]; replyTo?: string; subject: string; text: string; html: string; attachments: { fileName: string; mimeType: string; content: Uint8Array }[]; idempotencyKey: string };
type Provider = { name: string; maxAttachBytes: number; inlineAttachBytes?: number; send(mail: Mail): Promise<{ id: string }> };
'''
idx=re.sub(r'^import "\.\./_shared/sla-engine\.js";\n', '', idx, flags=re.M)
idx=re.sub(r'^import \{ handle, HttpError \} from "\./handler\.ts";\n', '', idx, flags=re.M)
idx=re.sub(r'^import \{ pickProvider \} from "\.\./send-email/providers\.ts";\n', '', idx, flags=re.M)
m=re.search(r'^import \{ createClient \}.*\n', idx, flags=re.M); imp=m.group(0); idx=idx.replace(imp,'')
out=f'''// @ts-nocheck
// overdue-mail as ONE file for Supabase Dashboard > Edge Functions > Deploy a new function > Via Editor.
// Generated from supabase/functions/overdue-mail/*.ts, send-email/providers.ts and _shared/sla-engine.js; do not edit by hand.
// After deploy: function Details/Settings > turn OFF "Verify JWT" (Enforce JWT verification).
{imp}
// ===== _shared/sla-engine.js =====
{eng}
// ===== send-email/providers.ts =====
{types}{unexport(prov)}
// ===== overdue-mail/handler.ts =====
{unexport(hand)}
// ===== overdue-mail/index.ts =====
{idx}'''
assert len(re.findall(r'^import ', out, flags=re.M))==1, re.findall(r'^import .*', out, flags=re.M)
open(sys.argv[1],'w').write(out)
