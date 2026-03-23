import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, data } = body;
    if (!id || !data) {
      return NextResponse.json({ error: "Missing id or data" }, { status: 400 });
    }
    const sql = getDb();
    const jsonData = JSON.stringify(data);
    await sql`INSERT INTO rampage_cows (id, data) VALUES (${id}, ${jsonData}::jsonb) ON CONFLICT (id) DO UPDATE SET data = ${jsonData}::jsonb`;
    return NextResponse.json({ id });
  } catch (err) {
    console.error("POST /api/cow error:", err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const sql = getDb();
    const rows = await sql`SELECT data FROM rampage_cows WHERE id = ${id}`;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0].data);
  } catch (err) {
    console.error("GET /api/cow error:", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
