// apps/web/src/app/api/ingest/seed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import OpenAI from "openai";
import crypto from "crypto";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";

function toVecLiteral(v: number[], frac = 6) {
  return "[" + v.map(x => Number(x).toFixed(frac)).join(",") + "]";
}

export async function POST(req: NextRequest) {
  try {
    const { ns, docs, clear, clearAll } = await req.json();
    if (!ns || !Array.isArray(docs) || docs.length === 0) {
      return NextResponse.json({ error: "expected { ns, docs:[{title,content}], clear?: boolean, clearAll?: boolean }" }, { status: 400 });
    }

    const corpusId = `seed:${ns}`;

    // Полная зачистка по ns (всех старых корпусов), если clearAll = true
    if (clearAll === true) {
      await q(`delete from chunks where ns = $1 and slot = 'staging'`, [ns]);
    } else if (clear === true) {
      // Мягкая очистка только нашего seed-корпуса
      await q(`delete from chunks where ns = $1 and slot = 'staging' and corpus_id = $2`, [ns, corpusId]);
    }

    // Гарантируем запись корпуса
    await q(
      `insert into corpus_registry (id, ns, owner, license, update_cadence, source_list, half_life_days, ttl_days, created_at, updated_at)
       values ($1, $2, $3, 'internal', 'manual', $4::jsonb, 180, 365, now(), now())
       on conflict (id) do nothing`,
      [corpusId, ns, "dev", JSON.stringify([])]
    );

    // Эмбеддинги
    const contents: string[] = docs.map((d: any) => String(d.content ?? ""));
    const titles: string[] = docs.map((d: any) => String(d.title ?? "seed"));
    const embRes = await openai.embeddings.create({ model: EMBED_MODEL, input: contents });

    // Вставка
    let added = 0;
    for (let i = 0; i < contents.length; i++) {
      const id = crypto.randomUUID();
      const content = contents[i];
      const title = titles[i];
      const emb = embRes.data[i].embedding as unknown as number[];
      const vec = toVecLiteral(emb, 6);
      const source = { title, url: undefined };
      const hash = crypto.createHash("sha256").update(ns + "||" + content).digest("hex");

      await q(
        `insert into chunks (id, corpus_id, ns, slot, content, embedding, source, content_hash, created_at)
         values ($1, $2, $3, 'staging', $4, $5::vector, $6::jsonb, $7, now())
         on conflict do nothing`,
        [id, corpusId, ns, content, vec, JSON.stringify(source), hash]
      );
      added++;
    }

    return NextResponse.json({ ns, corpusId, added, slot: "staging", cleared: !!clear, clearedAll: !!clearAll }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "seed ingest failed" }, { status: 500 });
  }
}
