// apps/web/src/app/api/health/env/route.ts
export const runtime = "nodejs";

export async function GET() {
  return new Response(
    JSON.stringify({
      openai_key_present: !!process.env.OPENAI_API_KEY,
      db_url_present: !!process.env.DATABASE_URL
    }),
    { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
}
