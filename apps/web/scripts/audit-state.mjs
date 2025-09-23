// apps/web/scripts/audit-state.mjs
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { exec as _exec } from "node:child_process";
import { fileURLToPath } from "node:url";
const exec = (cmd) => new Promise((res) => _exec(cmd, (e, stdout) => res((stdout||"").trim())));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- helpers ----------
async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
async function sha256(file) {
  const buf = await fs.readFile(file);
  return crypto.createHash("sha256").update(buf).digest("hex");
}
async function readEnvLocal() {
  const envPath = path.join(process.cwd(), "apps", "web", ".env.local");
  if (!(await exists(envPath))) return {};
  const lines = (await fs.readFile(envPath, "utf8")).split(/\r?\n/);
  const res = {};
  for (const ln of lines) {
    const m = ln.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    res[k] = v;
  }
  return res;
}
async function jfetch(url, opts = {}, adminKey) {
  const headers = { ...(opts.headers || {}) };
  if (adminKey) headers["x-admin-key"] = adminKey;
  const r = await fetch(url, { ...opts, headers });
  let json = null; let text = null;
  try { json = await r.json(); } catch { text = await r.text(); }
  return { status: r.status, json, text };
}

// ---------- config ----------
const BASE = process.env.AUDIT_BASE_URL || "http://localhost:3000";
const envLocal = await readEnvLocal();
const ADMIN_KEY = process.env.X_ADMIN_KEY || envLocal.X_ADMIN_KEY || "";

// ключевые файлы, которые проверяем
const keyFiles = [
  "apps/web/src/app/chat/page.tsx",
  "apps/web/src/app/api/rag/answer/route.ts",
  "apps/web/src/app/api/rag/answer-guarded/route.ts",
  "apps/web/src/app/api/rag/answer-logged/route.ts",
  "apps/web/src/app/api/rag/answer-logged-guarded/route.ts",
  "apps/web/src/lib/profile-runtime.ts",
  "apps/web/src/lib/profiles.ts",
  "apps/web/src/middleware.ts",
  "apps/web/middleware.ts",
  "apps/web/src/app/api/admin/logs/list/route.ts",
  "apps/web/src/app/api/admin/whoami/route.ts",
  "apps/web/src/app/api/health/env/route.ts",
  "apps/web/src/app/api/health/db/route.ts",
];

// ---------- gather ----------
const gitHead = await exec("git rev-parse HEAD").catch(() => "");
const gitDirty = await exec("git status --porcelain").catch(() => "");
const npmWebPkgPath = path.join(process.cwd(), "apps", "web", "package.json");
const pkg = JSON.parse(await fs.readFile(npmWebPkgPath, "utf8"));

const filesInfo = [];
for (const rel of keyFiles) {
  const abs = path.join(process.cwd(), rel);
  const ok = await exists(abs);
  if (!ok) {
    filesInfo.push({ file: rel, exists: false });
  } else {
    const hash = await sha256(abs);
    const size = (await fs.stat(abs)).size;
    filesInfo.push({ file: rel, exists: true, size, sha256: hash });
  }
}

// API pings
const api = {};
api.health_env   = await jfetch(`${BASE}/api/health/env`);
api.health_db    = await jfetch(`${BASE}/api/health/db`);
api.whoami_nohdr = await jfetch(`${BASE}/api/admin/whoami`);
api.whoami_hdr   = await jfetch(`${BASE}/api/admin/whoami`, {}, ADMIN_KEY);
api.logs_list    = await jfetch(`${BASE}/api/admin/logs/list?limit=3`, {}, ADMIN_KEY);
api.profiles     = await jfetch(`${BASE}/api/profiles/get`);

// Тестовый RAG-вопрос (guarded, короткий)
const testBody = {
  query: "Кратко: что делает Rebecca.Docs?",
  ns: "rebecca/docs",
  topK: 8,
  minScore: 0.35,
  maxTokens: 450
};
api.rag_answer_guarded = await jfetch(`${BASE}/api/rag/answer-guarded`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(testBody),
});

// ---------- render STATE.md ----------
const now = new Date().toISOString();
const dupeMiddleware = filesInfo.filter(f => /\/middleware\.ts$/.test(f.file) && f.exists).length > 1;

const stateMd = `# STATE SNAPSHOT — ${now}

**Base URL:** ${BASE}  
**Git HEAD:** \`${gitHead}\`  
**Working tree dirty:** ${gitDirty ? "YES" : "no"}  
**apps/web version:** ${pkg.version || "(no version)"}  

## Files (key)
${filesInfo.map(f => `- ${f.exists ? "✅" : "❌"} \`${f.file}\`${f.exists ? ` — ${f.size} bytes — sha256:${f.sha256.slice(0,12)}…`:""}`).join("\n")}

${dupeMiddleware ? "\n> ⚠️ Найдено два middleware.ts — **оставьте только apps/web/src/middleware.ts**\n" : ""}

## API health
- /api/health/env → status ${api.health_env.status}
- /api/health/db  → status ${api.health_db.status}
- /api/admin/whoami (без ключа) → status ${api.whoami_nohdr.status}
- /api/admin/whoami (с x-admin-key) → status ${api.whoami_hdr.status}, body: \`${JSON.stringify(api.whoami_hdr.json||api.whoami_hdr.text)}\`
- /api/admin/logs/list?limit=3 → status ${api.logs_list.status}, count: ${(api.logs_list.json&&api.logs_list.json.count)||"?"}
- /api/profiles/get → status ${api.profiles.status}, items: ${(api.profiles.json&&api.profiles.json.count)||"?"}

## Test: RAG answer-guarded
- status: ${api.rag_answer_guarded.status}
- ok: ${(api.rag_answer_guarded.json && api.rag_answer_guarded.json.ok)}
- profile: ${(api.rag_answer_guarded.json && api.rag_answer_guarded.json.profile) || "-"}
- sources#: ${api.rag_answer_guarded.json && api.rag_answer_guarded.json.sources ? api.rag_answer_guarded.json.sources.length : 0}
- snippet: \`${(api.rag_answer_guarded.json && api.rag_answer_guarded.json.answer || "").slice(0,160).replace(/\n/g," ")}...\`

---

> Generated by \`apps/web/scripts/audit-state.mjs\`
`;

await fs.writeFile(path.join(process.cwd(), "STATE.md"), stateMd, "utf8");

// Сырой дамп логов (если есть)
if (api.logs_list.json && Array.isArray(api.logs_list.json.items)) {
  const ndjson = api.logs_list.json.items.map(x => JSON.stringify(x)).join("\n") + "\n";
  const outDir = path.join(process.cwd(), "audit", "raw");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "admin.logs.ndjson"), ndjson, "utf8");
}

console.log("STATE.md written. Summary:");
console.log(stateMd.split("\n").slice(0, 30).join("\n"));
