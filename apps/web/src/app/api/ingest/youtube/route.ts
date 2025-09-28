// apps/web/src/app/api/ingest/youtube/route.ts
import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { retryFetch } from "@/lib/retryFetch";
import { assertAdmin } from "@/lib/admin";
import { upsertChunksWithTargets, type IngestDoc } from "@/lib/ingest_upsert";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ytdl from "ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStaticPath from "ffmpeg-static";
import { OpenAI } from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: "staging" | "prod" | string | null;
  kind?: string | null;

  url?: string | null;
  videoId?: string | null;
  lang?: string | null;
  includeTimestamps?: boolean | null;

  dryRun?: boolean | null;
  skipEmbeddings?: boolean | null;
  chunk?: { chars?: number; overlap?: number };
  minChars?: number | null;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// ---------- ffmpeg path resolve (force system first) ----------
const SYSTEM_FFMPEG = (process.env.FFMPEG_PATH || "/usr/bin/ffmpeg").trim();
const STATIC_FFMPEG = String(ffmpegStaticPath || "").trim();

const pickFfmpeg = () => {
  try {
    if (SYSTEM_FFMPEG && fs.existsSync(SYSTEM_FFMPEG)) return SYSTEM_FFMPEG;
  } catch {}
  try {
    if (STATIC_FFMPEG && fs.existsSync(STATIC_FFMPEG)) return STATIC_FFMPEG;
  } catch {}
  return "ffmpeg"; // fallback to PATH
};

const RESOLVED_FFMPEG = pickFfmpeg();
ffmpeg.setFfmpegPath(RESOLVED_FFMPEG);

// ----------------- utils -----------------

function ensureVideoId(input?: string | null): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace(/^\/+/, "");
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
  } catch {}
  return null;
}

async function oembed(url: string) {
  try {
    const res = await retryFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { headers: { "User-Agent": UA } }
    );
    if (!res.ok) return null;
    const j = await res.json();
    return {
      title: (j?.title as string) || null,
      author_name: (j?.author_name as string) || null,
      thumbnail_url: (j?.thumbnail_url as string) || null,
    };
  } catch {
    return null;
  }
}

type TranscriptItem = { text: string; offset?: number; duration?: number };

function decodeHTMLEntities(s: string): string {
  const map: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };
  return s
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => map[m] || m)
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

// --- путь 1: публичный сервис youtubetranscript.rip ---
async function fetchViaRip(videoId: string, lang?: string | null): Promise<TranscriptItem[]> {
  const tryOnce = async (url: string) => {
    const res = await retryFetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    if (!j) return null;
    const arr: any[] = Array.isArray(j)
      ? j
      : Array.isArray((j as any).transcripts)
      ? (j as any).transcripts
      : [];
    return arr.map((x: any) => ({
      text: x?.text ?? "",
      offset: Number(x?.offset ?? x?.start) || undefined,
      duration: Number(x?.duration) || undefined,
    })) as TranscriptItem[];
  };
  if (lang) {
    const u = `https://youtubetranscript.rip/api/v1/?id=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`;
    const withLang = await tryOnce(u);
    if (withLang?.length) return withLang;
  }
  const u2 = `https://youtubetranscript.rip/api/v1/?id=${encodeURIComponent(videoId)}`;
  const def = await tryOnce(u2);
  return def ?? [];
}

// --- путь 2: прямой YouTube timedtext (XML), включая авто-сабы ---
async function fetchViaTimedtext(videoId: string, lang?: string | null): Promise<TranscriptItem[]> {
  const want = (lang || "").trim();
  const candidates: string[] = [];
  if (want) {
    candidates.push(want);
    if (want.includes("-")) candidates.push(want.split("-")[0]);
  }
  for (const x of ["en", "en-US", "en-GB", "ru", "ru-RU"]) {
    if (!candidates.includes(x)) candidates.push(x);
  }

  const tryTimedText = async (l: string, asr: boolean) => {
    const url =
      `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(l)}` +
      (asr ? "&kind=asr" : "");
    const res = await retryFetch(url, {
      headers: { "User-Agent": UA, Accept: "application/xml,text/xml,*/*" },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml || !xml.includes("<transcript")) return null;

    const items: TranscriptItem[] = [];
    const re = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const attrs = m[1] || "";
      const body = decodeHTMLEntities((m[2] || "").replace(/<[^>]+>/g, "").trim());
      const startMatch = /(?:^|\s)start="([\d.]+)"/.exec(attrs);
      const durMatch = /(?:^|\s)dur="([\d.]+)"/.exec(attrs);
      const start = startMatch ? Number(startMatch[1]) : undefined;
      const dur = durMatch ? Number(durMatch[1]) : undefined; // <-- fixed
      const duration = Number.isFinite(dur) ? dur : undefined;
      if (body) items.push({ text: body, offset: start, duration });
    }
    return items;
  };

  for (const l of candidates) {
    const got = await tryTimedText(l, false);
    if (got?.length) return got;
  }
  for (const l of candidates) {
    const got = await tryTimedText(l, true);
    if (got?.length) return got;
  }
  return [];
}

// --- путь 0: библиотека youtube-transcript (если доступна) ---
async function fetchTranscript(videoId: string, lang?: string | null): Promise<TranscriptItem[]> {
  try {
    const { YoutubeTranscript } = await import("youtube-transcript" as any);
    if (lang) {
      const t = await (YoutubeTranscript as any).fetchTranscript(videoId, { lang });
      if (t?.length) {
        return t.map((x: any) => ({
          text: x?.text || "",
          offset: Number(x?.offset) || undefined,
          duration: Number(x?.duration) || undefined,
        }));
      }
    }
    const t = await (YoutubeTranscript as any).fetchTranscript(videoId);
    if (t?.length) {
      return t.map((x: any) => ({
        text: x?.text || "",
        offset: Number(x?.offset) || undefined,
        duration: Number(x?.duration) || undefined,
      }));
    }
  } catch {}

  try {
    const rip = await fetchViaRip(videoId, lang);
    if (rip?.length) return rip;
  } catch {}

  try {
    const tt = await fetchViaTimedtext(videoId, lang);
    if (tt?.length) return tt;
  } catch {}

  return [];
}

function msToTimestamp(ms?: number) {
  if (!ms || ms < 0) return "00:00";
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ------------- Whisper fallback -------------

async function downloadAudioToWav(videoIdOrUrl: string): Promise<string> {
  const id = ensureVideoId(videoIdOrUrl);
  if (!id) throw new Error("invalid YouTube url or id");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytw-"));
  const outPath = path.join(tmpDir, `${id}.wav`);

  await new Promise<void>((resolve, reject) => {
    const stream = ytdl(id, {
      quality: "highestaudio",
      filter: "audioonly",
      highWaterMark: 1 << 25,
    });

    ffmpeg(stream as any)
      // путь уже установлен глобально; повторно зададим явно на всякий случай
      .setFfmpegPath(RESOLVED_FFMPEG)
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .on("error", reject)
      .on("end", () => resolve())
      .save(outPath);
  });

  return outPath;
}

async function transcribeWithWhisper(filePath: string, language?: string | null): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const openai = new OpenAI({ apiKey });

  const file = fs.createReadStream(filePath);
  const res = await (openai as any).audio.transcriptions.create({
    model: "whisper-1",
    file,
    language: language || undefined,
    response_format: "text",
  });
  const text = typeof res === "string" ? res : (res as any).text ?? "";
  return String(text).replace(/\s+/g, " ").trim();
}

// ----------------- route -----------------

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage = "init";
  let tmpAudio: string | null = null;

  try {
    assertAdmin(req);

    const {
      ns,
      slot = "staging",
      kind = "youtube",
      url,
      videoId: explicitId,
      lang = null,
      includeTimestamps = false,
      dryRun = false,
      skipEmbeddings = false,
      chunk,
      minChars: minCharsRaw = 64,
    } = (await req.json()) as Body;

    const minChars = Number.isFinite(Number(minCharsRaw)) ? Math.max(0, Number(minCharsRaw)) : 64;

    if (!ns) {
      return NextResponse.json({ ok: false, stage, error: "ns required" }, { status: 400 });
    }
    const vid = ensureVideoId(explicitId || url);
    if (!vid) {
      return NextResponse.json({ ok: false, stage, error: "video url or id required" }, { status: 400 });
    }
    const videoUrl = `https://www.youtube.com/watch?v=${vid}`;
    const opts = normalizeChunkOpts(chunk);

    // 1) метаданные (не критично)
    stage = "meta";
    const meta = await oembed(videoUrl);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        ns,
        slot,
        videoId: vid,
        url: videoUrl,
        title: meta?.title || null,
        author: meta?.author_name || null,
        textChunks: 0,
        preview: null,
        method: null,
        ms: Date.now() - t0,
        dryRun: true,
      });
    }

    // 2) транскрипт: многоуровневый фоллбэк
    stage = "transcript";
    let items = await fetchTranscript(vid, lang);
    let method: "captions" | "whisper" = "captions";

    if (!items?.length || items.map((i) => i.text).join(" ").trim().length < minChars) {
      stage = "whisper";
      tmpAudio = await downloadAudioToWav(vid);
      const text = await transcribeWithWhisper(tmpAudio, lang);
      if (!text || text.length < minChars) {
        try { if (tmpAudio) fs.rmSync(path.dirname(tmpAudio), { recursive: true, force: true }); } catch {}
        return NextResponse.json(
          { ok: false, stage, error: "transcript too short", debug: { method: "whisper", len: text?.length ?? 0 } },
          { status: 400 }
        );
      }
      items = text.split(/\n{2,}/g).map((p) => ({ text: p.trim() })).filter((x) => x.text.length > 0);
      method = "whisper";
    }

    // 3) собрать текст
    stage = "compose";
    const text =
      method === "captions"
        ? (includeTimestamps
            ? items.map((it) => `[${msToTimestamp((it.offset || 0) * 1000)}] ${it.text}`).join("\n")
            : items.map((it) => it.text).join(" ").replace(/\s+\n\s+/g, "\n").trim())
        : items.map((it) => it.text).join("\n").replace(/\s+\n\s+/g, "\n").trim();

    if (!text || text.length < minChars) {
      try { if (tmpAudio) fs.rmSync(path.dirname(tmpAudio), { recursive: true, force: true }); } catch {}
      return NextResponse.json(
        { ok: false, stage: "compose", error: "transcript too short", debug: { method, len: text?.length ?? 0 } },
        { status: 400 }
      );
    }

    // 4) chunk → upsert
    stage = "chunk";
    const parts = chunkText(text, opts);
    if (!parts.length) {
      try { if (tmpAudio) fs.rmSync(path.dirname(tmpAudio), { recursive: true, force: true }); } catch {}
      return NextResponse.json({
        ok: true,
        ns, slot,
        videoId: vid, url: videoUrl,
        method,
        textChunks: 0,
        textInserted: 0,
        textUpdated: 0,
        unchanged: 0,
        embedWritten: 0,
        ms: Date.now() - t0,
      });
    }

    const sourceId = `youtube:${vid}`;
    const doc: IngestDoc = {
      ns,
      slot,
      source_id: sourceId,
      url: videoUrl,
      title: meta?.title || null,
      published_at: null,
      source_type: "youtube",
      kind: kind || "youtube",
      doc_metadata: {
        source_type: "youtube",
        videoId: vid,
        url: videoUrl,
        lang: lang || null,
        includeTimestamps: !!includeTimestamps,
        oembed: meta || null,
        chunk: opts,
        chunk_total: parts.length,
        method,
      },
      chunks: parts.map((content, i) => ({
        content,
        chunk_no: i,
        metadata: {
          source_type: "youtube",
          videoId: vid,
          url: videoUrl,
          lang: lang || null,
          includeTimestamps: !!includeTimestamps,
          chunk: opts,
          chunk_chars: content.length,
          method,
        },
      })),
    };

    stage = "db-upsert";
    const { inserted, updated, targets, unchanged } = await upsertChunksWithTargets([doc]);

    // 5) эмбеддинги
    let embedWritten = 0;
    if (!skipEmbeddings && targets.length) {
      stage = "embed";
      const vectorsRaw = await embedMany(targets.map((t) => t.content));

      const toPgVector = (v: any): string => {
        const arr: number[] = Array.isArray(v)
          ? v.map((x) => Number(x))
          : Array.isArray((v as any)?.embedding)
          ? (v as any).embedding.map((x: any) => Number(x))
          : [];
        if (!arr.length) throw new Error("Empty embedding vector");
        return `[${arr.join(",")}]`;
      };

      const ids = targets.map((t) => t.id);
      const vecs = vectorsRaw.map((v: any) => toPgVector(v));

      stage = "db-embed";
      const { pool } = await import("@/lib/pg");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `
          WITH data AS (
            SELECT UNNEST($1::text[]) AS id, UNNEST($2::text[]) AS vec
          )
          UPDATE chunks c
          SET embedding = data.vec::vector, updated_at = NOW()
          FROM data
          WHERE c.id = data.id
          `,
          [ids, vecs]
        );
        await client.query("COMMIT");
        embedWritten = ids.length;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    try { if (tmpAudio) fs.rmSync(path.dirname(tmpAudio), { recursive: true, force: true }); } catch {}

    return NextResponse.json({
      ok: true,
      ns, slot,
      videoId: vid,
      url: videoUrl,
      title: meta?.title || null,
      method,
      textChunks: parts.length,
      textInserted: inserted,
      textUpdated: updated,
      unchanged,
      embedWritten,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    try { if (tmpAudio) fs.rmSync(path.dirname(tmpAudio), { recursive: true, force: true }); } catch {}
    return NextResponse.json({ ok: false, stage, error: e?.message || String(e) }, { status: 500 });
  }
}
