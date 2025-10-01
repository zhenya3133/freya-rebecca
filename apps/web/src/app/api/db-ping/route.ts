import { NextResponse } from "next/server";
import { Client } from "pg";

export async function GET() {
  const url = process.env.DATABASE_URL!;
  const client = new Client({ connectionString: url, ssl: false as any });
  await client.connect();
  const r = await client.query("select 1 as ok");
  await client.end();
  return NextResponse.json({ ok: r.rows[0]?.ok === 1 });
}
