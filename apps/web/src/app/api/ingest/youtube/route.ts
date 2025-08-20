// apps/web/src/app/api/ingest/youtube/route.ts
import { NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";
import { chunkText } from "../../../../lib/chunk";
import { upsertMemoriesBatch } from "../../../../lib/memories";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/youtube
 * Body: { urlOrId: string; kind: string; lang?: string; chunk?: { size?: number; overlap?: number; minSize?: number } }
 * Требует заголовок: x-admin-key
 */
export async function POST(req: Request) {
  try {
    const { urlOrId, kind, lang, chunk } = await req.json() as {
      urlOrId?: string; kind?: string; lang?: string; chunk?: { size?: number; overlap?: number; minSize?: number };
    };
    if (!urlOrId || !kind) return NextResponse.json({ ok:false, error:"urlOrId and kind are required" }, { status:400 });

    // получаем субтитры (автоязык/указанный)
    let transcript;
    try {
      transcript = await YoutubeTranscript.fetchTranscript(urlOrId, lang ? { lang } : undefined);
    } catch (e) {
      return NextResponse.json({ ok:false, error:"no transcript available" }, { status:422 });
    }

    const text = transcript.map(t => t.text).join(" ").replace(/\s+/g, " ").trim();
    if (!text || text.length < 200) {
      return NextResponse.json({ ok:false, error:"transcript too short" }, { status:422 });
    }

    // попробуем получить title через oEmbed (без ключа)
    let title: string | undefined;
    try {
      const id = urlOrId.includes("http") ? new URL(urlOrId).searchParams.get("v") : urlOrId;
      const oembed = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
      if (oembed.ok) {
        const data = await oembed.json() as any;
        title = data?.title;
      }
    } catch {}

    const pieces = chunkText(text, { size: chunk?.size ?? 1500, overlap: chunk?.overlap ?? 200, minSize: chunk?.minSize ?? 400 });
    const items = pieces.map((content, idx) => ({
      content,
      metadata: { source_type: "youtube", urlOrId, lang: lang ?? "auto", title, chunk_index: idx }
    }));

    const inserted = await upsertMemoriesBatch(kind, items);
    return NextResponse.json({ ok:true, inserted, count: inserted.length, kind, title });
  } catch (e:any) {
    console.error("POST /api/ingest/youtube error:", e?.message ?? e);
    return NextResponse.json({ ok:false, error:String(e?.message ?? e) }, { status:500 });
  }
}
