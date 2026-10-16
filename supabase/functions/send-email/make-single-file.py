# Builds send-email as one file for Supabase Dashboard > Edge Functions > send-email > Code (no CLI needed).
# Usage: python3 supabase/functions/send-email/make-single-file.py send-email-single-file.ts
import re, sys, os
D=os.path.dirname(os.path.abspath(__file__))+'/'
hand=open(D+'handler.ts').read()
prov=open(D+'providers.ts').read()
idx=open(D+'index.ts').read()
unexport=lambda s: re.sub(r'^export (?=(async |function|const|class|interface|type))', '', s, flags=re.M)
prov=re.sub(r'^import type .*\n', '', prov, flags=re.M)
idx=re.sub(r'^import \{ handle, HttpError \} from "\./handler\.ts";\n', '', idx, flags=re.M)
idx=re.sub(r'^import \{ pickProvider \} from "\./providers\.ts";\n', '', idx, flags=re.M)
m=re.search(r'^import \{ createClient \}.*\n', idx, flags=re.M); imp=m.group(0); idx=idx.replace(imp,'')
out=f'''// @ts-nocheck
// send-email as ONE file for Supabase Dashboard > Edge Functions > send-email > Code: replace index.ts with this, delete the other files, Deploy.
// Generated from supabase/functions/send-email/*.ts; do not edit by hand. Keep "Verify JWT" OFF as before.
{imp}
// ===== send-email/handler.ts =====
{unexport(hand)}
// ===== send-email/providers.ts =====
{unexport(prov)}
// ===== send-email/index.ts =====
{idx}'''
assert len(re.findall(r'^import ', out, flags=re.M))==1, re.findall(r'^import .*', out, flags=re.M)
open(sys.argv[1],'w').write(out)
