import { timetable } from "@/lib/timetable";
import { vehicles } from "@/lib/schedule";
import { cachedRt } from "@/lib/realtime";
import { bad, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const b = (u.get("bbox") || "").split(",").map(Number);
  if (b.length !== 4 || b.some((x) => !Number.isFinite(x))) return bad("bbox=w,s,e,n required");
  if ((b[2] - b[0]) * (b[3] - b[1]) > 0.06) return json({ vehicles: [], tooLarge: true, now: Date.now() });
  const tt = timetable();
  const list = vehicles(tt, b as [number, number, number, number], Date.now()).map((v) => ({ ...v, rt: cachedRt(v.tripId, v.serviceDate) }));
  return json({ vehicles: list, now: Date.now() });
}
