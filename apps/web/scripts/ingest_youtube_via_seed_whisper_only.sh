#!/usr/bin/env bash
set -euo pipefail

# ===== required env =====
: "${BASE:?need BASE, e.g. http://localhost:3000}"
: "${X_ADMIN_KEY:?need X_ADMIN_KEY (from .env.local)}"
: "${NS:?need NS, e.g. rebecca/army/refs}"
: "${SLOT:=staging}"
: "${OPENAI_API_KEY:?need OPENAI_API_KEY (from .env.local)}"

WHISPER_MODEL="${WHISPER_MODEL:-whisper-1}"

URL="${1:-}"
MAX_SEC="${2:-900}"   # default 15 min
if [[ -z "$URL" ]]; then
  echo "Usage: $0 <youtube_url_or_id> [max_seconds]" >&2
  exit 1
fi

log(){ printf '[yt-whisper] %s\n' "$*"; }

# extract 11-char video id
ensure_id() {
  local in="$1"
  if [[ "$in" =~ ^[A-Za-z0-9_-]{11}$ ]]; then echo "$in"; return 0; fi
  if [[ "$in" =~ v=([A-Za-z0-9_-]{11}) ]]; then echo "${BASH_REMATCH[1]}"; return 0; fi
  if [[ "$in" =~ youtu\.be/([A-Za-z0-9_-]{11}) ]]; then echo "${BASH_REMATCH[1]}"; return 0; fi
  return 1
}

VID="$(ensure_id "$URL" || true)"
if [[ -z "$VID" ]]; then
  echo "Cannot parse video id from: $URL" >&2
  exit 1
fi

tmpdir="$(mktemp -d -t ytwhisper-XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT
work="$tmpdir/$VID"; mkdir -p "$work"

log "Video ID: $VID"

# bestaudio direct URL (yt-dlp), convert to wav 16k mono, trim to MAX_SEC
log "Extracting audio via yt-dlp + ffmpeg (<= ${MAX_SEC}s)…"
WAV="$work/${VID}.wav"
ffmpeg -hide_banner -loglevel error \
  -ss 0 -t "$MAX_SEC" \
  -i "$(yt-dlp -f bestaudio --no-check-certificates -g "https://www.youtube.com/watch?v=${VID}")" \
  -ac 1 -ar 16000 -vn -f wav "$WAV"

# Whisper API
log "Transcribing via Whisper API…"
TXT="$work/${VID}.txt"
curl -sS -X POST "https://api.openai.com/v1/audio/transcriptions" \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: multipart/form-data" \
  -F "model=${WHISPER_MODEL}" \
  -F "response_format=text" \
  -F "file=@${WAV}" \
  > "$TXT"

if [[ ! -s "$TXT" ]]; then
  echo "Whisper transcription failed (empty output)" >&2
  exit 1
fi

# Chunk text
log "Chunking text…"
CHUNKS="$work/chunks.json"
python3 - "$TXT" "$CHUNKS" <<'PY'
import sys, json, re
inp, outp = sys.argv[1], sys.argv[2]
CHARS = 1200
OVER  = 120
with open(inp, 'r', encoding='utf-8', errors='ignore') as f:
    txt = f.read()
txt = re.sub(r'\s+', ' ', txt).strip()
parts = []
i = 0; k = 0; n = len(txt)
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

if [[ ! -s "$CHUNKS" ]]; then
  echo "No chunks produced" >&2
  exit 1
fi

# Seed payload
log "POST /api/ingest/seed …"
PAYLOAD="$work/seed_payload.json"
jq -n \
  --arg ns "$NS" \
  --arg slot "$SLOT" \
  --arg sid "youtube:${VID}" \
  --arg url "https://www.youtube.com/watch?v=${VID}" \
  --arg title "$VID" \
  --slurpfile ch "$CHUNKS" \
'{
  ns: $ns,
  slot: $slot,
  items: [{
    source_id: $sid,
    url: $url,
    title: $title,
    source_type: "youtube",
    kind: "youtube-whisper",
    doc_metadata: { ingest: "seed", note: "yt whisper only" },
    chunks: $ch[0]
  }],
  minChars: 32,
  dryRun: false
}' > "$PAYLOAD"

curl -sS -X POST "$BASE/api/ingest/seed" \
  -H "content-type: application/json" \
  -H "x-admin-key: $X_ADMIN_KEY" \
  --data-binary @"$PAYLOAD" \
  | jq '{ok, textChunks, textInserted, textUpdated, unchanged, targetsCount, ms, error}'

# Backfill
if [[ -d "$(dirname "$0")/.." ]]; then
  pushd "$(dirname "$0")/.." >/dev/null
  if [[ -x "./scripts/embed_backfill.sh" ]]; then
    log "Running embed_backfill…"
    ADMIN_KEY="${ADMIN_KEY:-$X_ADMIN_KEY}" ./scripts/embed_backfill.sh "$NS" "$SLOT" | jq .
  else
    log "Warning: scripts/embed_backfill.sh not found or not executable"
  fi
  popd >/dev/null
fi

log "Done."
