#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_KEY:-${X_ADMIN_KEY:-}}"

if [ $# -lt 3 ]; then
  echo "Usage: $0 <ns> <slot> <video_url_or_id> [--lang <en|ru|...>] [--timestamps] [--dry] [--no-emb] [--chars N] [--overlap N]" >&2
  exit 1
fi

ns="$1"; slot="$2"; v="$3"; shift 3
lang=""
timestamps="false"
dry="false"
noemb="false"
chars=""
overlap=""

while [ $# -gt 0 ]; do
  case "$1" in
    --lang) lang="$2"; shift 2;;
    --timestamps) timestamps="true"; shift 1;;
    --dry) dry="true"; shift 1;;
    --no-emb) noemb="true"; shift 1;;
    --chars) chars="$2"; shift 2;;
    --overlap) overlap="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

# простая проверка: это «чистый» 11-символьный ID или URL?
videoId_field=""
url_field=""
if [[ "$v" =~ ^[A-Za-z0-9_-]{11}$ ]]; then
  videoId_field="$v"
else
  url_field="$v"
fi

# собираем JSON Питоном (чтобы не зависеть от особенностей jq)
payload="$(
  NS="$ns" SLOT="$slot" VIDEOID="$videoId_field" URL="$url_field" LANG="$lang" \
  DRY="$dry" NOEMB="$noemb" TIMESTAMPS="$timestamps" CHARS="$chars" OVERLAP="$overlap" \
  python3 - <<'PY'
import os, json

def truthy(x): 
    return str(x).lower() == "true"

d = {
    "ns":   os.environ["NS"],
    "slot": os.environ["SLOT"],
}

vid = os.environ.get("VIDEOID","").strip()
url = os.environ.get("URL","").strip()
lang = os.environ.get("LANG","").strip()
dry  = truthy(os.environ.get("DRY","false"))
noem = truthy(os.environ.get("NOEMB","false"))
tst  = truthy(os.environ.get("TIMESTAMPS","false"))
chars = os.environ.get("CHARS","").strip()
over  = os.environ.get("OVERLAP","").strip()

if vid:
    d["videoId"] = vid
elif url:
    d["url"] = url

if lang:
    d["lang"] = lang
if dry:
    d["dryRun"] = True
if noem:
    d["skipEmbeddings"] = True
if tst:
    d["includeTimestamps"] = True

chunk = {}
if chars:
    try: chunk["chars"] = int(chars)
    except: pass
if over:
    try: chunk["overlap"] = int(over)
    except: pass
if chunk:
    d["chunk"] = chunk

print(json.dumps(d, ensure_ascii=False))
PY
)"

# отправляем
curl -sS -X POST "$BASE/api/ingest/youtube" \
  -H 'content-type: application/json' \
  -H "x-admin-key: ${ADMIN_KEY}" \
  --data-binary "$payload"
echo
