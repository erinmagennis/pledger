// GET /api/pools/test-match-pool
// Live state of MatchPool v1 on Tempo Moderato: summary() plus Deposited and Donated logs,
// newest first, with block timestamps. Cached for about 10 seconds.
import { NextResponse } from "next/server";
import { readPool } from "@/lib/tempo";

export const revalidate = 10;

export async function GET() {
  try {
    const data = await readPool();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : "unknown error";
    return NextResponse.json({ error: `Could not read the pool on Tempo: ${msg}` }, { status: 502 });
  }
}
