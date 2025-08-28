// apps/web/src/app/api/profiles/get/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

type Row = {
  id: string;
  ns: string;
  slot: "staging" | "prod";
  created_at: string;
  title: string | null;
  content: string; // JSON как текст
};

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ns = (url.searchParams.get("ns") || "rebecca/profiles").trim();
    const slot =
      (url.searchParams.get("slot") === "prod" ? "prod" : "staging") as
        | "staging"
        | "prod";

    const id = url.searchParams.get("id")?.trim() || "";
    const name = url.searchParams.get("name")?.trim() || "";

    if (!id && !name) {
      return NextResponse.json(
        { ok: false, error: "expected id or name" },
        { status: 400 }
      );
    }

    let row: Row | null = null;

    if (id) {
      if (!isUuidLike(id)) {
        return NextResponse.json(
          { ok: false, error: "id must be UUID" },
          { status: 400 }
        );
      }
      const r = await q<Row>(
        `
        select id, ns, slot, created_at,
               (source->>'title') as title,
               content
        from chunks
        where id = $1::uuid and ns = $2 and slot = $3
        limit 1
      `,
        [id, ns, slot]
      );
      row = r?.[0] ?? null;
    } else {
      // По имени: сравнение без учета регистра.
      // ВАЖНО: content::jsonb перед ->>
      const r = await q<Row>(
        `
        select id, ns, slot, created_at,
               (source->>'title') as title,
               content
        from chunks
        where ns = $1 and slot = $2
          and (
            lower(content::jsonb->>'name') = lower($3)
            or lower(source->>'title')     = lower($3)
          )
        order by created_at desc
        limit 1
      `,
        [ns, slot, name]
      );
      row = r?.[0] ?? null;
    }

    if (!row) {
      return NextResponse.json(
        { ok: false, error: "profile not found", ns, slot, id, name },
        { status: 404 }
      );
    }

    // Попробуем распарсить JSON профиля
    let profile: any = null;
    try {
      profile = JSON.parse(row.content);
    } catch {
      // если хранится не JSON, отдадим как есть
      profile = row.content;
    }

    return NextResponse.json({
      ok: true,
      ns,
      slot,
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      profile,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "profiles/get failed" },
      { status: 500 }
    );
  }
}
