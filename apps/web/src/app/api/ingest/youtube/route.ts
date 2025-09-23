// apps/web/src/app/api/ingest/youtube/route.ts
import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  url?: string | null;
  videoId?: string | null;
  preferLangs?: string[] | null; // e.g. ["ru","en"]
  slot?: string | null;
  kind?: string | null;
  chunk?: { chars?: number; overlap?: number };
};

function assertAdmin(req: Request) {
  const need = (process.env.X_ADMIN_KEY || "").trim();
  if (!need) return;
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (need && got !== need) throw new Error("unauthorized");
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function parseVideoId(u?: string | null): string | null {
  if (!u) return null;
  try {
    const m1 = u.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m1) return m1[1];
    const m2 = u.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m2) return m2[1];
    const m3 = u.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (m3) return m3[1];
  } catch {}
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

async function fetchTimedText(
  videoId: string,
  lang: string,
  asr = false,
  json3 = true
): Promise<{ text: string; format: "json3" | "xml"; langTried: string } | null> {
  const base = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(
    lang
  )}${asr ? "&kind=asr" : ""}`;
  const url = json3 ? `${base}&fmt=json3` : base;
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
      Referer: `https://www.youtube.com/watch?v=${videoId}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`yt captions ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  const txt = await res.text();
  if (!txt || txt.length < 20) return null;

  if (json3) {
    try {
      const j = JSON.parse(txt);
      const events = Array.isArray(j?.events) ? j.events : [];
      const parts: string[] = [];
      for (const ev of events) {
        const segs = Array.isArray(ev?.segs) ? ev.segs : [];
        for (const s of segs) {
          if (typeof s?.utf8 === "string") parts.push(s.utf8);
        }
      }
      const out = parts.join("").replace(/\s+/g, " ").trim();
      if (out) return { text: out, format: "json3", langTried: `${lang}${asr ? ":asr" : ""}` };
    } catch {
      // fallthrough: попробуем XML ниже
    }
  }

  // XML-ветка
  {
    const base2 = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(
      lang
    )}${asr ? "&kind=asr" : ""}`;
    const res2 = await fetch(base2, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        Referer: `https://www.youtube.com/watch?v=${videoId}`,
      },
    });
    if (!res2.ok) return null;
    const xml = await res2.text();
    const matches = Array.from(xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g));
    const parts = matches.map((m) =>
      decodeHtmlEntities(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    );
    const out = parts.join(" ").trim();
    if (out) return { text: out, format: "xml", langTried: `${lang}${asr ? ":asr" : ""}` };
  }

  return null;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    assertAdmin(req);
    const {
      ns,
      url,
      videoId: vid0,
      preferLangs = ["ru", "en"],
      slot = "staging",
      kind = "youtube",
      chunk,
    } = (await req.json()) as Body;

    if (!ns) return NextResponse.json({ ok: false, error: "ns is required" }, { status: 400 });
    const videoId = vid0 || parseVideoId(url || "");
    if (!videoId) {
      return NextResponse.json({ ok: false, error: "videoId or url is required" }, { status: 400 });
    }

    let best:
      | {
          text: string;
          format: "json3" | "xml";
          langTried: string;
        }
      | null = null;

    const langs = preferLangs && preferLangs.length ? preferLangs : ["en"];
    for (const l of langs) {
      try {
        best =
          (await fetchTimedText(videoId, l, true, true)) ||
          (await fetchTimedText(videoId, l, false, true)) ||
          (await fetchTimedText(videoId, l, true, false)) ||
          (await fetchTimedText(videoId, l, false, false));
        if (best) break;
      } catch (e) {
        // продолжаем пробовать другие варианты/языки
        best = null;
      }
    }

    if (!best) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "no captions available (try another video, or later we can enable Whisper ASR)",
        },
        { status: 422 }
      );
    }

    const opts = normalizeChunkOpts(chunk);
    const chunks = chunkText(best.text, opts);
    const vectors = await embedMany(chunks);
    const records = chunks.map((content, i) => ({
      kind: kind || "youtube",
      ns,
      slot,
      content,
      embedding: vectors[i],
      metadata: {
        source_type: "youtube",
        url,
        video_id: videoId,
        caption_format: best.format,
        lang_tried: best.langTried,
        chunk: opts,
        chunk_index: i,
        chunk_chars: content.length,
      },
    }));
    const written: number = await upsertMemoriesBatch(records);

    return NextResponse.json({
      ok: true,
      ns,
      slot,
      url,
      videoId,
      lang: best.langTried,
      chunks: chunks.length,
      written,
            ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
