#!/usr/bin/env bash
set -euo pipefail

# ==== ENV ====
: "${BASE:=http://localhost:3000}"
: "${X_ADMIN_KEY:?need X_ADMIN_KEY}"
: "${NS:?need NS}"
: "${SLOT:=staging}"
export ADMIN_KEY="${ADMIN_KEY:-$X_ADMIN_KEY}"

# ==== Windows Desktop/Custom in/out ====
if [ -n "${WINDOWS_INGEST_DIR:-}" ]; then
  BASE_DIR="$WINDOWS_INGEST_DIR"
else
  WIN_DESKTOP=$(wslpath "$(powershell.exe -NoProfile -Command "[Environment]::GetFolderPath('Desktop')" | tr -d '\r')")
  BASE_DIR="${WIN_DESKTOP}/Rebecca_Ingest"
fi
IN_DIR="${BASE_DIR}/in"
OUT_DIR="${BASE_DIR}/out"
mkdir -p "$IN_DIR" "$OUT_DIR"
echo "[ingest] using BASE_DIR=$BASE_DIR"

# ==== deps check ====
need() { command -v "$1" >/dev/null 2>&1 || { echo "need $1"; exit 1; }; }
need pandoc; need catdoc; need jq; need python3; need curl; need pdftotext
has_ocrmypdf=0; command -v ocrmypdf >/dev/null 2>&1 && has_ocrmypdf=1 || true
has_tesseract=0; command -v tesseract >/dev/null 2>&1 && has_tesseract=1 || true
has_pdftoppm=0; command -v pdftoppm >/dev/null 2>&1 && has_pdftoppm=1 || true
if [ $has_ocrmypdf -eq 0 ] && [ $has_tesseract -eq 0 ]; then
  echo "[warn] OCR tools not found. Install: sudo apt-get install -y ocrmypdf tesseract-ocr tesseract-ocr-rus poppler-utils"
fi

# ==== tmp ====
TMP_DIR=/tmp/rebecca_ingest
TXT_DIR="$TMP_DIR/txt"
PDF_OCR_DIR="$TMP_DIR/ocrpdf"
rm -rf "$TMP_DIR"; mkdir -p "$TXT_DIR" "$PDF_OCR_DIR"

pdf_to_text() {
  local in_pdf="$1"; local out_txt="$2"
  # 1) обычный текст?
  if pdftotext -layout "$in_pdf" "$out_txt" 2>/dev/null && [ -s "$out_txt" ]; then
    return 0
  fi
  # 2) OCR через ocrmypdf
  if [ $has_ocrmypdf -eq 1 ]; then
    local ocr_pdf="$PDF_OCR_DIR/$(basename "$in_pdf")"
    ocrmypdf --quiet --force-ocr "$in_pdf" "$ocr_pdf" || true
    [ -f "$ocr_pdf" ] && pdftotext -layout "$ocr_pdf" "$out_txt" 2>/dev/null || true
    [ -s "$out_txt" ] && return 0
  fi
  # 3) запасной вариант — tesseract
  if [ $has_tesseract -eq 1 ]; then
    if [ $has_pdftoppm -eq 1 ]; then
      local imgdir="$TMP_DIR/imgs_$$"; mkdir -p "$imgdir"
      pdftoppm -r 300 -png "$in_pdf" "$imgdir/page" >/dev/null 2>&1 || true
      ls "$imgdir"/page*.png >/dev/null 2>&1 && tesseract "$imgdir"/page*.png "$out_txt" -l rus+eng --psm 3 >/dev/null 2>&1 || true
      [ -f "${out_txt}.txt" ] && mv "${out_txt}.txt" "$out_txt"
      rm -rf "$imgdir"
    else
      # прямой путь PDF→PDF с текстовым слоем, затем pdftotext
      tesseract "$in_pdf" "$out_txt" -l rus+eng --psm 3 pdf >/dev/null 2>&1 || true
      [ -f "${out_txt}.pdf" ] && pdftotext -layout "${out_txt}.pdf" "$out_txt" 2>/dev/null || true
      rm -f "${out_txt}.pdf" || true
    fi
    [ -s "$out_txt" ] && return 0
  fi
  [ -s "$out_txt" ] || rm -f "$out_txt"
}

# ==== convert .docx/.doc/.pdf -> .txt ====
find "$IN_DIR" -maxdepth 1 -type f \( -iname '*.docx' -o -iname '*.doc' -o -iname '*.pdf' \) | while read -r f; do
  bn="$(basename "$f")"; base="${bn%.*}"
  if echo "$bn" | grep -qi '\.docx$'; then
    pandoc -f docx -t plain "$f" -o "$TXT_DIR/$base.txt"
  elif echo "$bn" | grep -qi '\.doc$'; then
    catdoc "$f" > "$TXT_DIR/$base.txt" || true
  else
    pdf_to_text "$f" "$TXT_DIR/$base.txt" || true
  fi
done

# ==== build items (chunk ~1200, overlap 120) ====
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
    if not os.path.isfile(p): continue
    txt=open(p,'r',encoding='utf-8',errors='ignore').read().replace('\r',' ').strip()
    if not txt: continue
    title=os.path.splitext(fn)[0]
    abs_linux_path=os.path.abspath(p)
    sid="text:"+hashlib.sha1(abs_linux_path.encode("utf-8")).hexdigest()[:16]
    items.append({
        "source_id": sid, "url": None, "title": title,
        "source_type": "text", "kind": "text",
        "doc_metadata": {
            "ingest":"seed","file":fn,"chunk_chars":CHARS,"overlap":OVER,
            "path_linux":abs_linux_path,"content_sha1": hashlib.sha1(txt.encode("utf-8")).hexdigest()
        },
        "chunks": chunks_for_text(txt)
    })
print(json.dumps(items, ensure_ascii=False))
PY

# ---- auth self-check (dryRun) ----
echo "[auth-check] Using X_ADMIN_KEY (len=${#X_ADMIN_KEY})"
jq -n \
  --arg ns "$NS" \
  --arg slot "$SLOT" \
  '{
    ns:$ns, slot:$slot, minChars:16, dryRun:true,
    items:[{
      source_id:"text:auth-selfcheck",
      url:null, title:"Auth self-check",
      source_type:"text", kind:"text", doc_metadata:{},
      chunks:[{chunk_no:0, content:"This is a long enough auth-check content string (≥ 16 chars)."}]
    }]
  }' \
| curl -sS -X POST "$BASE/api/ingest/seed" \
    -H "content-type: application/json" \
    -H "x-admin-key: ${X_ADMIN_KEY}" \
    --data-binary @- \
| jq '{ok,dryRun,error}'

# ==== payload -> seed ====
jq -n --arg ns "$NS" --arg slot "$SLOT" --slurpfile items /tmp/items.json \
'{ ns:$ns, slot:$slot, items:$items[0], minChars:32, dryRun:false }' > /tmp/seed_batch.json

curl -sS -X POST "$BASE/api/ingest/seed" \
  -H "content-type: application/json" -H "x-admin-key: ${X_ADMIN_KEY}" \
  --data-binary @/tmp/seed_batch.json \
| tee "$OUT_DIR/seed_result.json" \
| jq '{ok,textChunks,textInserted,textUpdated,unchanged,targetsCount,ms,error}'

# ==== embeddings backfill ====
BACKFILL_SH="./apps/web/scripts/embed_backfill.sh"
[ -f "$BACKFILL_SH" ] || BACKFILL_SH="./scripts/embed_backfill.sh"
if [ -f "$BACKFILL_SH" ]; then
  bash "$BACKFILL_SH" "$NS" "$SLOT" | tee "$OUT_DIR/embed_backfill.log"
else
  echo "[warn] embed_backfill.sh not found in apps/web/scripts or ./scripts"
fi
