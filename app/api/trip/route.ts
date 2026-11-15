import { timetable } from "@/lib/timetable";
import { tripById } from "@/lib/schedule";
import { tripRealtime } from "@/lib/realtime";
import { bad, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const id = u.get("id"), date = u.get("date");
  if (!id || !date || !/^\d{8}$/.test(date)) return bad("id and date (YYYYMMDD) required");
  const tt = timetable();
  const trip = tripById(tt, id, date);
  if (!trip) return bad("unknown trip", 404);
  return json({ trip: { ...trip, rt: await tripRealtime(tt, id, date) }, now: Date.now() });
}
