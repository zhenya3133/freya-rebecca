// apps/web/src/app/api/ingest/seed/route.ts
import { NextResponse } from "next/server";
import { upsertChunksWithTargets } from "@/lib/ingest_upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IngestChunk = {
  chunk_no: number;
  content: string;
  metadata?: Record<string, any>;
};

type IngestItem = {
  source_id: string | null;
  url: string | null;
  title: string | null;
  published_at?: string | null;
  source_type?: string | null;
  kind?: string | null;
  doc_metadata?: Record<string, any>;
  chunks: IngestChunk[];
};

type Body = {
  ns: string;
  slot: "staging" | "prod" | (string & {});
  items: IngestItem[];
  minChars?: number;  // дефолт 64
  dryRun?: boolean;   // совместимо со стилем других роутов
};

export async function POST(req: Request) {
  const stage = { value: "init" as "init" | "validate" | "saving" };
  const t0 = Date.now();

  try {
    // admin guard — как в остальных инжестах
    const adminKey = req.headers.get("x-admin-key") ?? "";
    if (!process.env.X_ADMIN_KEY || adminKey !== process.env.X_ADMIN_KEY) {
      return NextResponse.json({ ok: false, stage: null, error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Body;
    const ns = body?.ns?.trim();
    const slot = (body?.slot ?? "staging") as Body["slot"];
    const items = Array.isArray(body?.items) ? body.items : [];
    const minChars = Number.isFinite(body?.minChars) ? Math.max(0, Number(body!.minChars)) : 64;
    const dryRun = !!body?.dryRun;

    if (!ns || !slot || items.length === 0) {
      return NextResponse.json({ ok: false, stage: "validate", error: "ns, slot, items[] required" }, { status: 400 });
    }

    stage.value = "validate";
    // Приводим к формату IngestDoc[] (как у остальных инжестов)
    const docs: Parameters<typeof upsertChunksWithTargets>[0] = [];
    let textChunks = 0;

    for (const it of items) {
      const source_id = it?.source_id ?? null;
      const url = it?.url ?? null;
      const title = it?.title ?? null;
      const published_at = it?.published_at ?? null;
      const source_type = it?.source_type ?? null;
      const kind = it?.kind ?? null;
      const docMeta = it?.doc_metadata ?? {};
      const chunks = Array.isArray(it?.chunks) ? it!.chunks : [];

      if (chunks.length === 0) {
        return NextResponse.json(
          { ok: false, stage: "validate", error: "item.chunks required", debug: { title, source_id, url } },
          { status: 400 }
        );
      }

      // в одном документе может быть несколько чанков (обычный кейс)
      const preparedChunks: { chunk_no: number; content: string; metadata?: Record<string, any> }[] = [];

      for (const ch of chunks) {
        const content = (ch?.content ?? "").toString();
        if (content.length < minChars) {
          return NextResponse.json(
            { ok: false, stage: "validate", error: "content too short", debug: { title, len: content.length } },
            { status: 400 }
          );
        }
        const chunk_no = Number(ch?.chunk_no);
        if (!Number.isFinite(chunk_no) || chunk_no < 0) {
          return NextResponse.json(
            { ok: false, stage: "validate", error: "invalid chunk_no", debug: { title, chunk_no } },
            { status: 400 }
          );
        }
        preparedChunks.push({ chunk_no, content, metadata: ch?.metadata ?? {} });
        textChunks += 1;
      }

      docs.push({
        ns,
        slot,
        source_id,
        url,
        title,
        published_at,
        source_type,
        kind,
        doc_metadata: docMeta,
        chunks: preparedChunks,
      } as any);
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        ns,
        slot,
        dryRun: true,
        textChunks,
        textInserted: 0,
        textUpdated: 0,
        unchanged: 0,
        ms: Date.now() - t0,
      });
    }

    stage.value = "saving";
    const { inserted, updated, unchanged, targets } = await upsertChunksWithTargets(docs);

    const ms = Date.now() - t0;
    return NextResponse.json({
      ok: true,
      ns,
      slot,
      dryRun: false,
      textChunks,
      textInserted: inserted,
      textUpdated: updated,
      unchanged,
      targetsCount: targets.length, // id+content для эмбеддингов — твой пайп их подберёт
      ms,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, stage: stage.value, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
