# Builds user-password as one file for Supabase Dashboard > Edge Functions > Via Editor (no CLI needed).
# Usage: python3 supabase/functions/user-password/make-single-file.py user-password-single-file.ts
import re, sys, os
D=os.path.dirname(os.path.abspath(__file__))+'/'
hand=open(D+'handler.ts').read()
idx=open(D+'index.ts').read()
unexport=lambda s: re.sub(r'^export (?=(async |function|const|class|interface|type))', '', s, flags=re.M)
idx=re.sub(r'^import \{ handle, HttpError \} from "\./handler\.ts";\n', '', idx, flags=re.M)
m=re.search(r'^import \{ createClient \}.*\n', idx, flags=re.M); imp=m.group(0); idx=idx.replace(imp,'')
out=f'''// @ts-nocheck
// user-password as ONE file for Supabase Dashboard > Edge Functions > Deploy a new function > Via Editor.
// Generated from supabase/functions/user-password/*.ts; do not edit by hand.
// After deploy: function Details/Settings > turn OFF "Verify JWT" (Enforce JWT verification).
{imp}
// ===== user-password/handler.ts =====
{unexport(hand)}
// ===== user-password/index.ts =====
{idx}'''
assert len(re.findall(r'^import ', out, flags=re.M))==1, re.findall(r'^import .*', out, flags=re.M)
open(sys.argv[1],'w').write(out)
