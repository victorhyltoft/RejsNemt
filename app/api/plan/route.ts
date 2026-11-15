import { timetable } from "@/lib/timetable";
import { plan } from "@/lib/raptor";
import { parseLocalParam } from "@/lib/time";
import { bad, int, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const lat = Number(u.get("fromLat")), lon = Number(u.get("fromLon"));
  const coord = u.has("fromLat") && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, name: "Din position" } : null;
  const tLat = Number(u.get("toLat")), tLon = Number(u.get("toLon"));
  const tcoord = u.has("toLat") && Number.isFinite(tLat) && Number.isFinite(tLon) ? { lat: tLat, lon: tLon, name: u.get("toName") || "Valgt sted" } : null;
  if (coord && u.get("fromName")) coord.name = u.get("fromName")!;
  const fromIdx = int(u.get("from")), toIdx = int(u.get("to"));
  if ((fromIdx === null && !coord) || (toIdx === null && !tcoord)) return bad("from/fromLat+fromLon and to/toLat+toLon are required");
  const tt = timetable();
  const S = tt.j.stations.id.length;
  if ((fromIdx !== null && fromIdx >= S) || (toIdx !== null && toIdx >= S)) return bad("unknown station", 404);
  const from = coord ?? fromIdx!;
  const to = tcoord ?? toIdx!;
  const timeMs = parseLocalParam(u.get("time")) ?? Date.now();
  const t0 = Date.now();
  const itineraries = plan(tt, { from, to, timeMs, arriveBy: u.get("arriveBy") === "1" });
  return json({ itineraries, ms: Date.now() - t0 });
}
