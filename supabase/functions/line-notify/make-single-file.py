# Builds line-notify as one file for Supabase Dashboard > Edge Functions > Via Editor (no CLI needed).
# Usage: python3 supabase/functions/line-notify/make-single-file.py line-notify-single-file.ts
import re, sys
import os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/'
eng=open(R+'_shared/sla-engine.js').read()
flex=open(R+'line-notify/flex.ts').read()
hand=open(R+'line-notify/handler.ts').read()
idx=open(R+'line-notify/index.ts').read()
unexport=lambda s: re.sub(r'^export (?=(async |function|const|class|interface|type))', '', s, flags=re.M)
hand=re.sub(r'^import .*flex\.ts";\n', '', hand, flags=re.M)
idx=re.sub(r'^import "\.\./_shared/sla-engine\.js";\n', '', idx, flags=re.M)
idx=re.sub(r'^import \{ handle, HttpError \} from "\./handler\.ts";\n', '', idx, flags=re.M)
m=re.search(r'^import \{ createClient \}.*\n', idx, flags=re.M); imp=m.group(0); idx=idx.replace(imp,'')
assert 'import' not in hand.split('\n',20)[-1] 
out=f'''// @ts-nocheck
// line-notify as ONE file for Supabase Dashboard > Edge Functions > Deploy a new function > Via Editor.
// Generated from supabase/functions/line-notify/*.ts and _shared/sla-engine.js; do not edit by hand.
// After deploy: function Details/Settings > turn OFF "Verify JWT" (Enforce JWT verification).
{imp}
// ===== _shared/sla-engine.js =====
{eng}
// ===== flex.ts =====
{unexport(flex)}
// ===== handler.ts =====
{unexport(hand)}
// ===== index.ts =====
{idx}'''
assert len(re.findall(r'^import ', out, flags=re.M))==1, re.findall(r'^import .*', out, flags=re.M)
open(sys.argv[1],'w').write(out)
