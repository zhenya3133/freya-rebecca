# apps/web/scripts/ingest_github.sh
#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_KEY:-${X_ADMIN_KEY:-}}"

if [ $# -lt 3 ]; then
  echo "Usage: $0 <ns> <slot> <owner/repo> [--ref <ref>] [--path <prefix>] [--include \".md,.txt\"] [--exclude \".png,.jpg\"] [--cursor N] [--limit M] [--dry] [--no-emb] [--chars N] [--overlap N]" >&2
  exit 1
fi

ns="$1"; slot="$2"; or="$3"; shift 3
owner="${or%%/*}"; repo="${or#*/}"

ref="main"
path=""
include=""
exclude=""
cursor=""
limit=""
dry="false"
noemb="false"
chars=""
overlap=""

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) ref="$2"; shift 2;;
    --path) path="$2"; shift 2;;
    --include) include="$2"; shift 2;;    # строка через запятую: ".md,.txt"
    --exclude) exclude="$2"; shift 2;;
    --cursor) cursor="$2"; shift 2;;
    --limit) limit="$2"; shift 2;;
    --dry) dry="true"; shift 1;;
    --no-emb) noemb="true"; shift 1;;
    --chars) chars="$2"; shift 2;;
    --overlap) overlap="$2"; shift 2;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

jq -n \
  --arg ns "$ns" \
  --arg slot "$slot" \
  --arg owner "$owner" \
  --arg repo "$repo" \
  --arg ref "$ref" \
  --arg path "$path" \
  --arg include "$include" \
  --arg exclude "$exclude" \
  --arg cursor "$cursor" \
  --arg limit "$limit" \
  --arg dry "$dry" \
  --arg noemb "$noemb" \
  --arg chars "$chars" \
  --arg overlap "$overlap" '
{
  ns:$ns, slot:$slot,
  owner:$owner, repo:$repo, ref:$ref,
}
+ ( ($path|length)>0 ? { path:$path } : {} )
+ ( ($include|length)>0 ? { includeExt: ($include|split(",")|map(.|gsub("^\\s+|\\s+$";""))) } : {} )
+ ( ($exclude|length)>0 ? { excludeExt: ($exclude|split(",")|map(.|gsub("^\\s+|\\s+$";""))) } : {} )
+ ( ($cursor|length)>0 ? { cursor: ($cursor|tonumber) } : {} )
+ ( ($limit|length)>0 ? { limit: ($limit|tonumber) } : {} )
+ ( ($dry == "true") ? { dryRun:true } : {} )
+ ( ($noemb == "true") ? { skipEmbeddings:true } : {} )
+ (
    ( ($chars|length)>0 or ($overlap|length)>0 )
    ? { chunk:
        ( {}
          + ( ($chars|length)>0 ? { chars: ($chars|tonumber) } : {} )
          + ( ($overlap|length)>0 ? { overlap: ($overlap|tonumber) } : {} )
        )
      }
    : {}
  )
' \
| curl -sS -X POST "$BASE/api/ingest/github" \
    -H "content-type: application/json" \
    -H "x-admin-key: ${ADMIN_KEY}" \
    --data-binary @-
