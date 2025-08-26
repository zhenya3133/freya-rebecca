// apps/web/src/app/api/ingest/seed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import OpenAI from "openai";
import crypto from "crypto";
import matter from "gray-matter";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";

function toVecLiteral(v: number[], frac = 6) {
  return "[" + v.map(x => Number(x).toFixed(frac)).join(",") + "]";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ns: string | undefined = body?.ns;
    const docs: any[] = Array.isArray(body?.docs) ? body.docs : [];
    const clear: boolean = body?.clear === true;
    const clearAll: boolean = body?.clearAll === true;

    if (!ns || docs.length === 0) {
      return NextResponse.json(
        { error: "expected { ns, docs:[{title,content}], clear?: boolean, clearAll?: boolean }" },
        { status: 400 }
      );
    }

    const corpusId = `seed:${ns}`;

    // Очистка
    if (clearAll === true) {
      await q(`delete from chunks where ns = $1 and slot = 'staging'`, [ns]);
    } else if (clear === true) {
      await q(`delete from chunks where ns = $1 and slot = 'staging' and corpus_id = $2`, [ns, corpusId]);
    }

    // Регистрируем корпус (если ещё не был)
    await q(
      `insert into corpus_registry (id, ns, owner, license, update_cadence, source_list, half_life_days, ttl_days, created_at, updated_at)
       values ($1, $2, $3, 'internal', 'manual', $4::jsonb, 180, 365, now(), now())
       on conflict (id) do nothing`,
      [corpusId, ns, "dev", JSON.stringify([])]
    );

    // Подготовим массивы чистого текста и источников с метаданными
    const contents: string[] = [];
    const titles: string[] = [];
    const sources: any[] = [];

    for (const d of docs) {
      const title = String(d?.title ?? "seed");

      // Разбор YAML фронт-маттера
      const parsed = matter(String(d?.content ?? ""));
      const cleanContent = String(parsed.content ?? "");
      const meta = (parsed.data && typeof parsed.data === "object") ? parsed.data : {};

      // Нормализуем source
      const source = {
        title,
        path: d?.path ?? title,
        url: d?.url ?? (typeof meta?.url === "string" ? meta.url : undefined),
        metadata: meta
      };

      titles.push(title);
      contents.push(cleanContent);
      sources.push(source);
    }

    // Эмбеддинги по очищенному контенту
    const embRes = await openai.embeddings.create({ model: EMBED_MODEL, input: contents });

    // Вставка чанков
    let added = 0;
    for (let i = 0; i < contents.length; i++) {
      const id = crypto.randomUUID();
      const content = contents[i];
      const title = titles[i];
      const emb = embRes.data[i].embedding as unknown as number[];
      const vec = toVecLiteral(emb, 6);
      const source = sources[i];

      // Включаем title + source в хэш для стабильной идемпотентности при пересеве
      const hash = crypto.createHash("sha256")
        .update(ns + "||" + title + "||" + JSON.stringify(source) + "||" + content)
        .digest("hex");

      await q(
        `insert into chunks (id, corpus_id, ns, slot, content, embedding, source, content_hash, created_at)
         values ($1, $2, $3, 'staging', $4, $5::vector, $6::jsonb, $7, now())
         on conflict do nothing`,
        [id, corpusId, ns, content, vec, JSON.stringify(source), hash]
      );
      added++;
    }

    return NextResponse.json(
      { ns, corpusId, added, slot: "staging", cleared: !!clear, clearedAll: !!clearAll },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "seed ingest failed" }, { status: 500 });
  }
}
