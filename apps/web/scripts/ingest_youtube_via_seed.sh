#!/usr/bin/env bash
set -euo pipefail

# ==== Требуемые переменные окружения ====
: "${BASE:?need BASE, e.g. http://localhost:3000}"
: "${X_ADMIN_KEY:?need X_ADMIN_KEY (из .env.local)}"
: "${NS:?need NS, e.g. rebecca/army/refs}"
: "${SLOT:=staging}"

# Whisper fallback (только если нет субтитров):
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
WHISPER_MODEL="${WHISPER_MODEL:-whisper-1}"

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "Usage: $0 <youtube_url_or_id>  [max_seconds]" >&2
  exit 1
fi
MAX_SEC="${2:-900}"   # по умолчанию 15 минут

# ==== Вспомогательные ====
tmpdir="$(mktemp -d -t ytseed-XXXXXX)"
cleanup() { rm -rf "$tmpdir" || true; }
trap cleanup EXIT

# Простая функция логов
log(){ printf '[yt-seed] %s\n' "$*"; }

# Извлечём ID (11 символов) из URL/ID
ensure_id() {
  local in="$1"
  if [[ "$in" =~ ^[A-Za-z0-9_-]{11}$ ]]; then
    echo "$in"; return 0
  fi
  # пробуем достать из v=...
  if [[ "$in" =~ v=([A-Za-z0-9_-]{11}) ]]; then
    echo "${BASH_REMATCH[1]}"; return 0
  fi
  # короткая форма youtu.be/ID
  if [[ "$in" =~ youtu\.be/([A-Za-z0-9_-]{11}) ]]; then
    echo "${BASH_REMATCH[1]}"; return 0
  fi
  return 1
}

VID="$(ensure_id "$URL" || true)"
if [[ -z "$VID" ]]; then
  echo "Cannot parse video id from: $URL" >&2
  exit 1
fi

log "Video ID: $VID"
work="$tmpdir/${VID}"
mkdir -p "$work"

# ==== 1) Пытаемся выкачать автосабы через yt-dlp ====
log "Trying to fetch auto-subs (ru,en)..."
set +e
yt-dlp \
  --skip-download \
  --write-auto-subs \
  --sub-lang "ru,en" \
  --sub-format "vtt" \
  -o "$work/%(id)s.%(ext)s" \
  "https://www.youtube.com/watch?v=${VID}" \
  >/dev/null 2>&1
rc=$?
set -e

txt="$work/${VID}.txt"
have_subs="0"

for vtt in "$work/${VID}."*.vtt; do
  if [[ -f "$vtt" ]]; then
    log "Found subs: $(basename "$vtt") -> convert to txt"
    python3 - "$vtt" "$txt" <<'PY'
import sys, re
vtt, out = sys.argv[1], sys.argv[2]
def strip_vtt(text: str) -> str:
    # убираем заголовки, таймкоды, веб-вебвтт метаданные
    lines = []
    for line in text.splitlines():
        if line.startswith("WEBVTT"): continue
        if re.match(r'^\d{2}:\d{2}:\d{2}\.\d{3}\s--> ', line): continue
        if re.match(r'^\d+\s*$', line): continue
        line = re.sub(r'<[^>]+>', '', line)  # html-теги
        line = line.strip()
        if line:
            lines.append(line)
    # иногда субтитры покадрово — склеиваем и убираем повторы
    text = ' '.join(lines)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

with open(vtt, 'r', encoding='utf-8', errors='ignore') as f:
    raw = f.read()
clean = strip_vtt(raw)
with open(out, 'w', encoding='utf-8') as f:
    f.write(clean + "\n")
PY
    if [[ -s "$txt" ]]; then
      have_subs="1"
      break
    fi
  fi
done

# ==== 2) Если субтитров нет — Whisper fallback ====
if [[ "$have_subs" != "1" ]]; then
  if [[ -z "$OPENAI_API_KEY" ]]; then
    echo "No subs and OPENAI_API_KEY is empty. Cannot transcribe via Whisper." >&2
    exit 1
  fi
  log "No subs. Extract audio and transcribe with Whisper..."

  wav="$work/${VID}.wav"
  # bestaudio -> wav 16k mono, обрезаем до MAX_SEC
  ffmpeg -hide_banner -loglevel error \
    -ss 0 -t "$MAX_SEC" \
    -i "$(yt-dlp -f bestaudio --no-check-certificates -g "https://www.youtube.com/watch?v=${VID}")" \
    -ac 1 -ar 16000 -vn -f wav "$wav"

  log "Send to Whisper API..."
  # multipart/form-data через curl
  resp="$work/whisper.json"
  curl -sS -X POST "https://api.openai.com/v1/audio/transcriptions" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -H "Content-Type: multipart/form-data" \
    -F "model=${WHISPER_MODEL}" \
    -F "response_format=text" \
    -F "file=@${wav}" \
    > "$txt"

  if [[ ! -s "$txt" ]]; then
    echo "Whisper transcription failed (empty output)" >&2
    exit 1
  fi
fi

# ==== 3) Чанкуем и готовим payload под /api/ingest/seed ====
log "Chunking text..."
chunks="$work/chunks.json"
python3 - "$txt" "$chunks" <<'PY'
import sys, json, re
inp, outp = sys.argv[1], sys.argv[2]
CHARS = 1200
OVER  = 120
with open(inp, 'r', encoding='utf-8', errors='ignore') as f:
    txt = f.read()
txt = re.sub(r'\s+', ' ', txt).strip()
parts = []
i = 0; k = 0
n = len(txt)
while i < n:
    part = txt[i:i+CHARS].strip()
    if part:
        parts.append({"chunk_no": k, "content": part})
        k += 1
    if i + CHARS >= n: break
    i += CHARS - OVER
with open(outp, 'w', encoding='utf-8') as f:
    json.dump(parts, f, ensure_ascii=False)
PY

if [[ ! -s "$chunks" ]]; then
  echo "No chunks produced" >&2
  exit 1
fi

# ==== 4) Собираем seed payload и шлём ====
log "POST /api/ingest/seed ..."
payload="$work/seed_payload.json"
jq -n \
  --arg ns "$NS" \
  --arg slot "$SLOT" \
  --arg sid "youtube:${VID}" \
  --arg url "https://www.youtube.com/watch?v=${VID}" \
  --arg title "$VID" \
  --slurpfile ch "$chunks" \
'{
  ns: $ns,
  slot: $slot,
  items: [{
    source_id: $sid,
    url: $url,
    title: $title,
    source_type: "youtube",
    kind: "youtube-seed",
    doc_metadata: { ingest: "seed", note: "yt via seed" },
    chunks: $ch[0]
  }],
  minChars: 32,
  dryRun: false
}' > "$payload"

curl -sS -X POST "$BASE/api/ingest/seed" \
  -H "content-type: application/json" \
  -H "x-admin-key: $X_ADMIN_KEY" \
  --data-binary @"$payload" | jq '{ok, textChunks, textInserted, textUpdated, unchanged, targetsCount, ms, error}'

# ==== 5) Запишем эмбеддинги ====
if [[ -d "$(dirname "$0")/.." ]]; then
  pushd "$(dirname "$0")/.." >/dev/null
  if [[ -x "./scripts/embed_backfill.sh" ]]; then
    log "Running embed_backfill..."
    ADMIN_KEY="${ADMIN_KEY:-$X_ADMIN_KEY}" ./scripts/embed_backfill.sh "$NS" "$SLOT" | jq .
  else
    log "Warning: scripts/embed_backfill.sh not found or not executable"
  fi
  popd >/dev/null
fi

log "Done."
