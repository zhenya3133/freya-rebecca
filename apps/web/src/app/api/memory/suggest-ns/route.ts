// apps/web/src/app/api/memory/suggest-ns/route.ts
import { suggestNamespace } from "@/lib/suggestNs";

export const runtime = "nodejs";

type Body = {
  title?: string;
  description?: string;
  mediaType?: string;
  tags?: string[];
  allow?: string[]; // если нужно ограничить набором полок
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const res = await suggestNamespace(body);
    return jsonOk(res);
  } catch (e: any) {
    return jsonErr(500, String(e?.message ?? e));
  }
}

function jsonOk(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonErr(status: number, message: string) {
  return jsonOk({ error: message }, status);
}
