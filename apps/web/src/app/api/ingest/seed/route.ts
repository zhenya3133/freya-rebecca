// apps/web/src/app/api/ingest/seed/route.ts
import { NextResponse } from "next/server";
import { upsertChunksWithTargets } from "@/lib/ingest_upsert";
import { assertAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IngestChunk = {
  chunk_no: number;
  content: string;
  metadata?: Record<string, any>;
};

type IngestItem = {
  source_id?: string | null;
  url?: string | null;
  title?: string | null;
  published_at?: string | null;
  source_type?: string | null;
  kind?: string | null;
  doc_metadata?: Record<string, any>;
  chunks: IngestChunk[];
};

type Body = {
  ns: string;
  slot?: "staging" | "prod" | (string & {});
  items: IngestItem[];
  minChars?: number;  // дефолт 64
  dryRun?: boolean;   // режим без записи
};

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage: "init" | "validate" | "saving" = "init";

  try {
    // Единый guard как в остальных инжест-роутах
    assertAdmin(req);

    const body = (await req.json()) as Body;

    const ns = (body?.ns || "").trim();
    const slot = ((body?.slot || "staging") as "staging" | "prod");
    const items = Array.isArray(body?.items) ? body.items : [];
    const minChars = Number.isFinite(body?.minChars)
      ? Math.max(0, Number(body!.minChars))
      : 64;
    const dryRun = !!body?.dryRun;

    // базовая валидация
    if (!ns || !["staging", "prod"].includes(slot) || items.length === 0) {
      return NextResponse.json(
        { ok: false, stage: "validate", error: "ns, slot ('staging'|'prod'), items[] required" },
        { status: 400 }
      );
    }

    stage = "validate";

    // Приводим к формату IngestDoc[] — тот же контракт, что и у других инжестов
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
      const chunks = Array.isArray(it?.chunks) ? it.chunks : [];

      if (chunks.length === 0) {
        return NextResponse.json(
          { ok: false, stage: "validate", error: "item.chunks required", debug: { title, source_id, url } },
          { status: 400 }
        );
      }

      const preparedChunks: { chunk_no: number; content: string; metadata?: Record<string, any> }[] = [];

      for (const ch of chunks) {
        const content = String(ch?.content ?? "");
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

    stage = "saving";
    const { inserted, updated, unchanged, targets } = await upsertChunksWithTargets(docs);

    return NextResponse.json({
      ok: true,
      ns,
      slot,
      dryRun: false,
      textChunks,
      textInserted: inserted,
      textUpdated: updated,
      unchanged,
      targetsCount: targets.length, // id+content вернутся для последующего эмбеддинга
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, stage, error: e?.message || String(e) },
      { status: e?.message === "unauthorized" ? 401 : 500 }
    );
  }
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
