// apps/web/src/app/api/rag/ask/route.ts
import { NextResponse } from "next/server";
import { q } from "../../../../lib/db";
import { embedOne } from "../../../../lib/embeddings";
import { applyMMRwithThreshold, parsePgVector, Candidate } from "../../../../lib/retriever";

/**
 * Вход: { query: string; ns?: string; k?: number; lambda?: number; minScore?: number }
 * Поиск по таблице memories:
 *   - фильтр по kind (= namespace), если задан ns
 *   - сравнение через pgvector: embedding <=> $1::vector
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userQuery: string = body?.query;
    const ns: string | undefined = body?.ns;
    const k: number | undefined = body?.k;
    const lambda: number | undefined = body?.lambda;
    const minScore: number | undefined = body?.minScore;

    if (!userQuery || typeof userQuery !== "string") {
      return NextResponse.json({ ok: false, error: "query is required" }, { status: 400 });
    }

    // 1) эмбеддинг запроса
    const qEmb = await embedOne(userQuery);

    // 2) представление для pgvector: строка "[...]" и SQL-каст $1::vector
    const qEmbLiteral = `[${qEmb.join(",")}]`;

    // 3) выбираем кандидатов (fetchK)
    const fetchK = 50;
    const sql = `
      SELECT id, kind, content, embedding, 1 - (embedding <=> $1::vector) AS score
        FROM memories
       WHERE embedding IS NOT NULL
       ${ns ? "AND kind = $2" : ""}
       ORDER BY embedding <=> $1::vector
       LIMIT ${fetchK}
    `;
    const rows = await q<any>(sql, ns ? [qEmbLiteral, ns] : [qEmbLiteral]);

    // 4) преобразуем кандидатов
    const candidates: Candidate[] = rows.map((r: any) => ({
      id: String(r.id),
      ns: r.kind ? String(r.kind) : undefined,
      content: String(r.content ?? ""),
      embedding: parsePgVector(r.embedding),
      score: Number(r.score),
    }));

    // 5) MMR + порог
    const top = applyMMRwithThreshold(
      candidates,
      qEmb,
      typeof k === "number" ? k : 8,
      typeof lambda === "number" ? lambda : 0.5,
      typeof minScore === "number" ? minScore : 0.78
    );

    return NextResponse.json({
      ok: true,
      matches: top.map(c => ({
        id: c.id,
        ns: c.ns,
        score: +c.score.toFixed(4),
        snippet: c.content.slice(0, 500),
      })),
    });
  } catch (e: any) {
    // Важный лог — чтобы видеть первопричину на сервере
    console.error("POST /api/rag/ask error:", e?.message ?? e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
