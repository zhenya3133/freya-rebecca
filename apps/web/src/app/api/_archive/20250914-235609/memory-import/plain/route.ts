// apps/web/src/app/api/memory/import/plain/route.ts
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { splitIntoChunks } from "@/lib/chunk";
import { suggestNamespace } from "@/lib/suggestNs";

export const runtime = "nodejs";

type Body = {
  ns?: string;             // можно не указывать — определим автоматически
  kind?: string;           // "doc" | "plan" | ...
  text?: string;           // исходный контент
  chunk?: { size?: number; overlap?: number };
  metadata?: Record<string, any>;
  autoConfirm?: boolean;   // если true — не спрашиваем, а кладём как решено
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const rawText = String(body.text ?? "").trim();
    if (!rawText) return jsonErr(400, "Provide 'text'");

    // 1) выбираем ns: если не пришёл — классифицируем
    let ns = (body.ns ?? "").trim();
    let decided = true;
    if (!ns) {
      const s = await suggestNamespace({
        title: body.kind ?? "doc",
        description: rawText.slice(0, 2000),
        mediaType: "text",
        tags: ["import", "plain"],
      });
      ns = s.ns;
      decided = s.decided;
      if (!body.autoConfirm && !decided) {
        // вернём предложение и не будем импортировать
        return jsonOk({ suggested: s, notice: "Not imported. Provide ns or set autoConfirm=true." }, 202);
      }
    }

    const kind = (body.kind ?? "doc");
    const meta = {
      ...(body.metadata ?? {}),
      ns,
      source: (body.metadata?.source ?? "plain"),
      lang: (body.metadata?.lang ?? detectLang(rawText)),
    };

    // 2) чанкование → эмбеддинги → вставка
    const parts = splitIntoChunks(rawText, body.chunk ?? {});
    let inserted = 0;
    for (const p of parts) {
      const emb = await getEmbedding(p);
      const vec = toVectorLiteral(emb);
      await pool.query(
        `INSERT INTO memories (kind, content, embedding, metadata)
         VALUES ($1, $2, $3::vector, $4::jsonb)`,
        [kind, p, vec, JSON.stringify(meta)]
      );
      inserted++;
    }

    return jsonOk({ ns, kind, chunks: parts.length, inserted, decided });
  } catch (e: any) {
    return jsonErr(500, String(e?.message ?? e));
  }
}

function detectLang(t: string): string {
  // очень грубо: кириллица -> ru, иначе en
  return /[а-яА-ЯЁё]/.test(t) ? "ru" : "en";
}
function jsonOk(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonErr(status: number, message: string) {
  return jsonOk({ error: message }, status);
}
