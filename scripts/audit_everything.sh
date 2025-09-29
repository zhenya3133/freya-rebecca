#!/usr/bin/env bash
set -euo pipefail

# ====== CONFIG / PATHS ======
ROOT="$(cd "$(dirname "$0")/.."; pwd)"
WEB="$ROOT/apps/web"
ENV_FILE="$WEB/.env.local"
OUT_DIR_MD="$ROOT/docs"
OUT_JSON="/tmp/rebecca_audit.json"
OUT_MD="$OUT_DIR_MD/AUDIT.md"
OUT_ROUTES="$OUT_DIR_MD/routes.txt"
OUT_DEPS="$OUT_DIR_MD/deps.txt"
OUT_IMPORTS_DOT="$OUT_DIR_MD/import_graph.dot"
OUT_IMPORTS_JSON="/tmp/rebecca_import_graph.json"
mkdir -p "$OUT_DIR_MD"

# ----- helper: jq "in-place" (замена sponge) -----
jq_inplace () {
  local tmp; tmp="$(mktemp)"
  jq "$@" "$OUT_JSON" > "$tmp" && mv "$tmp" "$OUT_JSON"
}

# ====== ENV ======
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2; exit 1
fi

BASE="${BASE:-http://localhost:3000}"
X_ADMIN_KEY="$(sed -n 's/^X_ADMIN_KEY=//p' "$ENV_FILE" | tr -d '\r')"
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tr -d '\r')"
NS="${NS:-rebecca/army/refs}"
SLOT="${SLOT:-staging}"
EMBED_DIMS_ENV="$(sed -n 's/^EMBED_DIMS=//p' "$ENV_FILE" | tr -d '\r')"
TS="$(date -Iseconds)"

# ====== REQUIREMENTS (soft) ======
need() { command -v "$1" >/dev/null 2>&1 || echo "WARN: '$1' not found (some sections will be skipped)"; }
need jq; need psql; need git; need curl; need node; need python3

# ====== INIT OUTPUT JSON ======
jq -n --arg ts "$TS" \
  --arg base "$BASE" --arg ns "$NS" --arg slot "$SLOT" \
  --arg env "$ENV_FILE" --arg db "$DATABASE_URL" \
  '{timestamp:$ts, base:$base, ns:$ns, slot:$slot, env_file:$env, database_url:$db,
    git:{}, files:{}, files_meta:{}, api:{}, db:{}, imports:{}, deps:{}}' > "$OUT_JSON"

# ====== GIT SNAPSHOT ======
GIT_BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
GIT_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "")"
GIT_STATUS="$(git -C "$ROOT" status --porcelain=v1 2>/dev/null || echo "")"
GIT_LAST="$(git -C "$ROOT" log -n 5 --pretty=format:'%h %ad %s' --date=iso 2>/dev/null || echo "")"
jq_inplace --arg br "$GIT_BRANCH" --arg head "$GIT_HEAD" --arg st "$GIT_STATUS" --arg last "$GIT_LAST" \
  '.git={branch:$br, head:$head, status:$st, last5:$last}'

# ====== ROUTES / FILE STRUCTURE ======
# FIX: порядок флагов find — сначала -maxdepth, потом -type
find "$WEB/src/app" -maxdepth 7 -type f | sort > "$OUT_ROUTES"
jq_inplace --arg routes "$(wc -l < "$OUT_ROUTES" | tr -d ' ')" \
  '.files_meta.routes_count=($routes|tonumber)'

# Key API presence flags
declare -A API_FILES=(
  ["seed"]="$WEB/src/app/api/ingest/seed/route.ts"
  ["url"]="$WEB/src/app/api/ingest/url/route.ts"
  ["github"]="$WEB/src/app/api/ingest/github/route.ts"
  ["youtube"]="$WEB/src/app/api/ingest/youtube/route.ts"
  ["retrieve"]="$WEB/src/app/api/retrieve/route.ts"
  ["embed_backfill"]="$WEB/src/app/api/admin/embed-backfill/route.ts"
)
for k in "${!API_FILES[@]}"; do
  p="${API_FILES[$k]}"
  present="no"; [[ -f "$p" ]] && present="yes"
  jq_inplace --arg k "$k" --arg p "$p" --arg present "$present" \
    '.files[$k]={path:$p, present:$present}'
done

# ====== PACKAGE / DEPS ======
if [[ -f "$WEB/package.json" ]]; then
  node -e 'console.log(JSON.stringify(require(process.argv[1]),null,2))' "$WEB/package.json" \
     > "$OUT_DEPS" 2>/dev/null || true
  jq_inplace '.deps.package_json=1'
else
  jq_inplace '.deps.package_json=0'
fi

# ====== IMPORT GRAPH (TS/TSX) ======
python3 - "$WEB/src" "$OUT_IMPORTS_JSON" "$OUT_IMPORTS_DOT" <<'PY'
import os, re, sys, json
src_root=sys.argv[1]; out_json=sys.argv[2]; out_dot=sys.argv[3]
imports={}
file_re = re.compile(r'\.(ts|tsx|js|jsx)$', re.I)
imp_re = re.compile(r'^\s*import\s+(?:[^"\']*from\s+)?["\']([^"\']+)["\']', re.M)
for root,_,files in os.walk(src_root):
    for f in files:
        if not file_re.search(f): continue
        p=os.path.join(root,f)
        try:
            with open(p,'r',encoding='utf-8',errors='ignore') as fh:
                s=fh.read()
        except:
            continue
        lst=imp_re.findall(s)
        rel=[x for x in lst if x.startswith('.') or x.startswith('@/')]
        imports[p]=rel
with open(out_json,'w',encoding='utf-8') as fo:
    json.dump(imports,fo,ensure_ascii=False,indent=2)
edges=[]
for a, deps in imports.items():
    for b in deps:
        edges.append((a,b))
with open(out_dot,'w',encoding='utf-8') as fo:
    fo.write('digraph imports {\n  rankdir=LR;\n  node [shape=box,fontsize=9];\n')
    for a,b in edges:
        a=a.replace('"','\\"'); b=b.replace('"','\\"')
        fo.write(f'  "{a}" -> "{b}";\n')
    fo.write('}\n')
print(f"files={len(imports)} edges={sum(len(v) for v in imports.values())}")
PY

if [[ -f "$OUT_IMPORTS_JSON" ]]; then
  FILES_CNT="$(jq 'keys|length' "$OUT_IMPORTS_JSON")"
  EDGES_CNT="$(jq '[.[]|length]|add' "$OUT_IMPORTS_JSON")"
  jq_inplace --argjson f "$FILES_CNT" --argjson e "$EDGES_CNT" \
     '.imports.files=$f | .imports.edges=$e'
fi

# ====== API SMOKE ======
api_ping () {
  local name="$1"; shift
  local res; res="$(curl -sS "$@" 2>/dev/null || true)"
  jq_inplace --arg name "$name" --arg payload "$res" \
     '.api[$name]=(try ($payload|fromjson) catch $payload)'
}
api_ping "debug_env" -X GET "$BASE/api/debug/env"
api_ping "retrieve_ping" -X POST "$BASE/api/retrieve" \
  -H "content-type: application/json" \
  --data-binary "{\"q\":\"ping\",\"ns\":\"$NS\",\"slot\":\"$SLOT\",\"nsMode\":\"prefix\",\"topK\":1}"

# ====== DB INTROSPECTION ======
if command -v psql >/dev/null 2>&1; then
  export PGCONNECT_TIMEOUT=3
  TABS="$(psql "$DATABASE_URL" -AXqt -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;" 2>/dev/null || true)"
  DOCS="$(psql "$DATABASE_URL" -AXqt -c "SELECT count(*) FROM docs;" 2>/dev/null || echo 0)"
  CHUNKS="$(psql "$DATABASE_URL" -AXqt -c "SELECT count(*) FROM chunks;" 2>/dev/null || echo 0)"
  EMBED="$(psql "$DATABASE_URL" -AXqt -c "SELECT count(*) FROM chunks WHERE embedding IS NOT NULL;" 2>/dev/null || echo 0)"
  ORPHAN_CHUNKS="$(psql "$DATABASE_URL" -AXqt -c "SELECT count(*) FROM chunks c LEFT JOIN docs d ON d.id=c.doc_id WHERE d.id IS NULL;" 2>/dev/null || echo 0)"
  VEC_DIMS="$(psql "$DATABASE_URL" -AXqt -c "SELECT coalesce((SELECT vector_dims(embedding) FROM chunks WHERE embedding IS NOT NULL LIMIT 1),0);" 2>/dev/null || echo 0)"
  PER_NS="$(psql "$DATABASE_URL" -AXqt -c "SELECT ns, slot, count(*) AS docs, sum((SELECT count(*) FROM chunks c WHERE c.doc_id=d.id)) AS chunks FROM docs d GROUP BY ns, slot ORDER BY ns, slot;" 2>/dev/null || true)"
  RECENT="$(psql "$DATABASE_URL" -AXqt -F $'\t' -c "SELECT id, ns, slot, title, created_at FROM docs ORDER BY created_at DESC LIMIT 10;" 2>/dev/null || true)"

  jq_inplace --arg tabs "$TABS" \
     --argjson docs "$(jq -n "$DOCS")" \
     --argjson chunks "$(jq -n "$CHUNKS")" \
     --argjson embedded "$(jq -n "$EMBED")" \
     --argjson orphan_chunks "$(jq -n "$ORPHAN_CHUNKS")" \
     --argjson vec_dims "$(jq -n "$VEC_DIMS")" \
     '.db.tables=($tabs|split("\n")|map(select(length>0))) |
      .db.counts={docs:$docs, chunks:$chunks, embedded:$embedded, orphan_chunks:$orphan_chunks, vector_dims:$vec_dims}'

  if [[ -n "$PER_NS" ]]; then
    echo "$PER_NS" | awk -F'|' '{for(i=1;i<=4;i++){gsub(/^ +| +$/,"",$i)}; print "{\"ns\":\""$1"\",\"slot\":\""$2"\",\"docs\":"$3",\"chunks\":"$4"}"}' \
    | jq -s '.' > /tmp/per_ns.json
    jq_inplace --slurpfile ns "/tmp/per_ns.json" '.db.per_ns=$ns[0]'
  fi

  echo "$RECENT" > "$OUT_DIR_MD/recent_docs.tsv"
else
  jq_inplace '.db.note="psql not found — DB section skipped"'
fi

# ====== RENDER MARKDOWN ======
python3 - "$OUT_JSON" "$OUT_MD" "$OUT_ROUTES" "$OUT_DEPS" "$OUT_IMPORTS_DOT" <<'PY'
import json,sys
j=json.load(open(sys.argv[1]))
md=[]
md.append("# AUDIT\n")
md.append(f"- Timestamp: `{j['timestamp']}`")
md.append(f"- BASE: `{j['base']}`  NS: `{j['ns']}`  SLOT: `{j['slot']}`")
md.append(f"- Env file: `{j['env_file']}`\n")

md.append("## Git")
g=j.get("git",{})
md.append(f"- Branch: `{g.get('branch','')}`  Head: `{g.get('head','')}`")
md.append(f"- Status:\n```\n{g.get('status','').strip()}\n```")
md.append(f"- Last 5:\n```\n{g.get('last5','').strip()}\n```\n")

md.append("## Files / API")
files=j.get("files",{})
for k,v in sorted(files.items()):
    if isinstance(v, dict) and 'present' in v and 'path' in v:
        md.append(f"- {k}: **{v['present']}** — {v['path']}")
meta=j.get("files_meta",{})
if meta:
    md.append(f"- routes_count: {meta.get('routes_count','?')}")
md.append("\nAll route files list saved to `docs/routes.txt`.\n")

md.append("## API Smoke")
api=j.get("api",{})
for k,v in api.items():
    import json as _json
    sn = _json.dumps(v, ensure_ascii=False)[:400]
    md.append(f"- {k}: ```json\n{sn}\n```")

md.append("\n## DB")
db=j.get("db",{})
counts=db.get("counts",{})
md.append(f"- Tables: {len(db.get('tables',[]))}")
md.append(f"- Docs: {counts.get('docs','?')}, Chunks: {counts.get('chunks','?')}, Embedded: {counts.get('embedded','?')}")
md.append(f"- Orphan chunks: {counts.get('orphan_chunks','?')}, Vector dims(sample): {counts.get('vector_dims','?')}")
if db.get("per_ns"):
    md.append("\n### Per NS/SLOT")
    for row in db["per_ns"]:
        md.append(f"- `{row['ns']}` / `{row['slot']}` — docs: {row['docs']}, chunks: {row['chunks']}")

md.append("\n(Recent docs TSV saved to `docs/recent_docs.tsv`.)\n")

imp=j.get("imports",{})
md.append("## Imports")
md.append(f"- Files parsed: {imp.get('files',0)}, edges: {imp.get('edges',0)}")
md.append(f"- DOT graph saved to `docs/import_graph.dot` (render via `dot -Tpng docs/import_graph.dot -o docs/import_graph.png`).\n")

deps=j.get("deps",{})
md.append("## Deps")
md.append(f"- package.json snapshot saved to `docs/deps.txt`.\n")

open(sys.argv[2],'w',encoding='utf-8').write("\n".join(md))
print(f"Wrote {sys.argv[2]}")
PY

echo "Wrote $OUT_MD and $OUT_JSON"
