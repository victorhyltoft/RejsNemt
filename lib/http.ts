import { NextResponse } from "next/server";

export function json(data: unknown, maxAge = 0) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": maxAge ? `public, max-age=${maxAge}, s-maxage=${maxAge}` : "no-store" },
  });
}

export function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export const int = (v: string | null) => (v !== null && /^\d+$/.test(v) ? +v : null);
