import { timetable } from "@/lib/timetable";
import { departures } from "@/lib/schedule";
import { withRealtime } from "@/lib/realtime";
import { bad, int, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const station = int(u.get("station"));
  const tt = timetable();
  if (station === null || station >= tt.j.stations.id.length) return bad("unknown station", 404);
  const limit = Math.min(60, int(u.get("limit")) ?? 40);
  const deps = departures(tt, station, Date.now() - 60e3, 120, limit);
  return json({ departures: await withRealtime(tt, station, deps), now: Date.now() });
}
