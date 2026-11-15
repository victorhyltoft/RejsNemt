import { timetable } from "@/lib/timetable";
import { tripRealtime } from "@/lib/realtime";
import { json } from "@/lib/http";
import type { Realtime } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const keys = (new URL(req.url).searchParams.get("trips") || "").split(",").filter(Boolean).slice(0, 8);
  const tt = timetable();
  const out: Record<string, Realtime | null> = {};
  for (const k of keys) {
    const [id, date] = k.split("|");
    if (!id || !/^\d{8}$/.test(date || "")) continue;
    out[k] = (await tripRealtime(tt, id, date)) ?? null;
  }
  return json({ rt: out, now: Date.now() });
}
