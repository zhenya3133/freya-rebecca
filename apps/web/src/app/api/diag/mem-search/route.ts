import { NextResponse } from "next/server";
import { pool, withPgRetry } from "../../../../lib/db";
import { embedMany } from "../../../../lib/embeddings";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { query, kind = "rebecca", topK = 5 } = await req.json() as {
      query: string; kind?: string; topK?: number;
    };
    if (!query) return NextResponse.json({ ok:false, error:"query is required" }, { status:400 });

    const [vec] = await embedMany([query]);
    const vecLit = `[${vec.join(",")}]`;

    const { rows } = await withPgRetry(() =>
      pool.query(
        `SELECT id, (metadata->>'path') AS path, length(content) AS len,
                (embedding <=> $1::vector) AS dist
         FROM memories
         WHERE kind = $2
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $3`,
        [vecLit, kind, Math.max(1, Math.min(20, topK ?? 5))]
      )
    );

    // чем меньше dist — тем ближе. Добавим удобный "score"
    const matches = rows.map(r => ({ ...r, score: 1 - Math.min(1, Number(r.dist)) }));

    return NextResponse.json({ ok:true, kind, query, matches });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message ?? e) }, { status:500 });
  }
}
