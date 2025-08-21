import { NextResponse } from "next/server";
import OpenAI from "openai";
import { pool, withPgRetry } from "../../../../lib/db";
import { embedMany } from "../../../../lib/embeddings";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED = new Set(["gpt-5", "gpt-5-mini", "gpt-5-nano"]);
const norm = (s?: string) => (s ?? "").trim();
const clamp = (s: string, n = 1200) => (s.length > n ? s.slice(0, n) : s);

function pickModel(override?: string) {
  const b = norm(override);
  if (b && !ALLOWED.has(b)) throw new Error(`unsupported_model: "${b}"`);
  const env = norm(process.env.RAG_MODEL);
  if (b) return b;
  if (env && ALLOWED.has(env)) return env;
  return "gpt-5-mini";
}

export async function POST(req: Request) {
  const steps: any[] = [];
  try {
    const body = await req.json();
    const {
      query,
      ns = "rebecca",
      topK = 6,
      minScore = 0.12,
      maxTokens = 200,
      model: modelOverride,
      noLLM = false,
      textFallback = false, // принудительный fallback по тексту
    } = body as any;

    if (!query) return NextResponse.json({ ok:false, error:"query is required" }, { status:400 });

    const model = pickModel(modelOverride);
    steps.push({ at:"begin", model, ns, topK, minScore, textFallback, noLLM });

    // ---------- 1) Получаем кандидатов ----------
    let docs: { id:string; path:string|null; url:string|null; score:number; content:string }[] = [];

    // вспомогательная функция: текстовый fallback через ILIKE
    async function fetchByText() {
      const r = await withPgRetry(() => pool.query(
        `SELECT id, content,
                (metadata->>'path') AS path,
                (metadata->>'url')  AS url,
                0.5 AS score
         FROM memories
         WHERE kind = $1 AND content ILIKE '%' || $2 || '%'
         ORDER BY created_at DESC
         LIMIT $3`,
        [ns, query, Math.max(1, Math.min(20, topK))]
      ));
      return (r.rows ?? []).map((x:any)=>({
        id: x.id, path: x.path, url: x.url, score: Number(x.score), content: String(x.content)
      }));
    }

    if (textFallback) {
      const t = Date.now();
      docs = await fetchByText();
      steps.push({ at:"text_fallback_ok", ms: Date.now()-t, count: docs.length });
    } else {
      // обычный путь: эмбеддинги + векторный поиск
      try {
        const t1 = Date.now();
        const [vec] = await embedMany([String(query)]);
        steps.push({ at:"embed_ok", ms: Date.now()-t1, dim: vec?.length });

        const vecLit = `[${vec.join(",")}]`;
        const t2 = Date.now();
        const r = await withPgRetry(() => pool.query(
          `SELECT id, content,
                  (metadata->>'path') AS path,
                  (metadata->>'url')  AS url,
                  (embedding <=> $1::vector) AS dist
           FROM memories
           WHERE kind = $2
           ORDER BY embedding <=> $1::vector ASC
           LIMIT $3`,
          [vecLit, ns, Math.max(1, Math.min(20, topK))]
        ));
        docs = (r.rows ?? []).map((row:any)=>{
          const dist = Number(row.dist);
          const score = 1 - Math.min(1, dist);
          return { id:row.id, path:row.path, url:row.url, content:String(row.content), score };
        }).filter((d:any)=> d.score >= minScore);
        steps.push({ at:"db_ok", ms: Date.now()-t2, count: docs.length });
      } catch (e:any) {
        const msg = String(e?.message ?? e);
        // если ошибка именно формата input у embeddings — автоматически уходим на текстовый fallback
        if (/\$\.input.*invalid/i.test(msg)) {
          steps.push({ at:"embed_failed_input_invalid", msg });
          const t = Date.now();
          docs = await fetchByText();
          steps.push({ at:"text_fallback_ok_after_embed_fail", ms: Date.now()-t, count: docs.length });
        } else {
          return NextResponse.json({ ok:false, where:"embed/db", error: msg, steps }, { status:502 });
        }
      }
    }

    if (!docs.length) {
      return NextResponse.json({ ok:true, mode:"none", model, answer:"Нет достаточного контекста.", steps });
    }

    // ---------- 2) Промпт ----------
    const context = docs.map((d,i)=>`[#${i+1}] ${d.url || d.path || d.id}\n${clamp(d.content)}`).join("\n\n------\n\n");
    const user = `Question: ${query}\n\nContext:\n${context}`;
    steps.push({ at:"prompt_built", userLen: user.length, ctxDocs: docs.length });

    if (noLLM) return NextResponse.json({ ok:true, mode:"dry", steps });

    // ---------- 3) Ответ через Responses ----------
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const params: OpenAI.ResponsesAPI.CreateParams = {
      model,
      instructions:
        "Answer ONLY from the provided context. Be concise (max 5–7 lines). Then print bullet list 'Sources:' with [#N] and path/URL.",
      max_output_tokens: maxTokens,
      input: [ { role: "user", content: [ { type: "input_text", text: user } ] } ],
    };

    try {
      // @ts-ignore
      const r = await client.responses.create(params);
      // @ts-ignore
      const text = (r as any).output_text || (r as any)?.content?.[0]?.text;
      return NextResponse.json({ ok:true, mode:"responses", model, answer:text, steps });
    } catch (e:any) {
      return NextResponse.json({ ok:false, where:"llm", error:String(e?.message ?? e), steps }, { status:502 });
    }
  } catch (e:any) {
    steps.push({ at:"catch", err:String(e?.message ?? e) });
    return NextResponse.json({ ok:false, error:String(e?.message ?? e), steps }, { status:500 });
  }
}
