#!/usr/bin/env bash
set -euo pipefail

# ==== ENV ====
: "${BASE:=http://localhost:3000}"
: "${X_ADMIN_KEY:?need X_ADMIN_KEY}"
: "${NS:?need NS}"
: "${SLOT:=staging}"
export ADMIN_KEY="${ADMIN_KEY:-$X_ADMIN_KEY}"

# ==== Windows Desktop in/out ====
WIN_DESKTOP=$(wslpath "$(powershell.exe -NoProfile -Command "[Environment]::GetFolderPath('Desktop')" | tr -d '\r')")
IN_DIR="${WIN_DESKTOP}/Rebecca_Ingest/in"
OUT_DIR="${WIN_DESKTOP}/Rebecca_Ingest/out"
mkdir -p "$IN_DIR" "$OUT_DIR"

# ==== deps check ====
need() { command -v "$1" >/dev/null 2>&1 || { echo "need $1"; exit 1; }; }
need pandoc; need catdoc; need jq; need python3; need curl; need pdftotext

# ==== tmp ====
TMP_DIR=/tmp/rebecca_ingest
TXT_DIR="$TMP_DIR/txt"
rm -rf "$TMP_DIR"; mkdir -p "$TXT_DIR"

# ==== convert .docx/.doc/.pdf -> .txt ====
find "$IN_DIR" -maxdepth 1 -type f \( -iname '*.docx' -o -iname '*.doc' -o -iname '*.pdf' \) | while read -r f; do
  bn="$(basename "$f")"; base="${bn%.*}"
  if echo "$bn" | grep -qi '\.docx$'; then
    pandoc -f docx -t plain "$f" -o "$TXT_DIR/$base.txt"
  elif echo "$bn" | grep -qi '\.doc$'; then
    catdoc "$f" > "$TXT_DIR/$base.txt" || true
  else
    pdftotext -layout "$f" "$TXT_DIR/$base.txt" || true
    [ -s "$TXT_DIR/$base.txt" ] || rm -f "$TXT_DIR/$base.txt"
  fi
done

# ==== build items (chunk ~1200, overlap 120, stable source_id by abs path) ====
export TXT_DIR
python3 - <<'PY' > /tmp/items.json
import os, json, hashlib
TXT_DIR=os.environ.get("TXT_DIR")
CHARS=1200; OVER=120
def chunks_for_text(s, ch=CHARS, ov=OVER):
    out=[]; i=0; n=len(s); k=0
    while i<n:
        part=s[i:i+ch].strip()
        if part: out.append({"chunk_no":k,"content":part})
        if i+ch>=n: break
        i+=ch-ov; k+=1
    return out
items=[]
for fn in sorted(os.listdir(TXT_DIR)):
    if not fn.lower().endswith(".txt"): continue
    p=os.path.join(TXT_DIR,fn)
    with open(p,'r',encoding='utf-8',errors='ignore') as f:
        txt=f.read().replace('\r',' ').strip()
    if not txt: continue
    title=os.path.splitext(fn)[0]
    abs_linux_path=os.path.abspath(p)
    sid="text:"+hashlib.sha1(abs_linux_path.encode("utf-8")).hexdigest()[:16]
    items.append({
        "source_id": sid,
        "url": None,
        "title": title,
        "source_type": "text",
        "kind": "text",
        "doc_metadata": {
            "ingest":"seed","file":fn,
            "chunk_chars":CHARS,"overlap":OVER,
            "path_linux":abs_linux_path,
            "content_sha1": hashlib.sha1(txt.encode("utf-8")).hexdigest()
        },
        "chunks": chunks_for_text(txt)
    })
print(json.dumps(items, ensure_ascii=False))
PY


# ---- auth self-check (dryRun) ----
echo "[auth-check] Using X_ADMIN_KEY (len=${#X_ADMIN_KEY})"
curl -sS -X POST "$BASE/api/ingest/seed" \
  -H "content-type: application/json" \
  -H "x-admin-key: ${X_ADMIN_KEY}" \
  --data-binary '{"ns":"'"$NS"'","slot":"'"$SLOT"'","items":[{"source_id":"text:auth-selfcheck","url":null,"title":"Auth self-check","source_type":"text","kind":"text","doc_metadata":{},"chunks":[{"chunk_no":0,"content":"auth check chunk > 32 chars"}]}],"minChars":32,"dryRun":true}' \
| jq '{ok,dryRun,error}'

# ==== payload -> seed ====
jq -n --arg ns "$NS" --arg slot "$SLOT" --slurpfile items /tmp/items.json \
'{ ns:$ns, slot:$slot, items:$items[0], minChars:32, dryRun:false }' > /tmp/seed_batch.json

curl -sS -X POST "$BASE/api/ingest/seed" \
  -H "content-type: application/json" \
  -H "x-admin-key: ${X_ADMIN_KEY}" \
  --data-binary @/tmp/seed_batch.json \
| tee "$OUT_DIR/seed_result.json" \
| jq '{ok,textChunks,textInserted,textUpdated,unchanged,targetsCount,ms,error}'

# ==== embeddings backfill ====
bash ./scripts/embed_backfill.sh "$NS" "$SLOT" | tee "$OUT_DIR/embed_backfill.log"
