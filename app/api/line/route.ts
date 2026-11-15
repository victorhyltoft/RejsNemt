import { timetable } from "@/lib/timetable";
import { linePatterns, patternGeo, routeVehicles } from "@/lib/schedule";
import { cachedRt } from "@/lib/realtime";
import { bad, int, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const tt = timetable();
  const pattern = int(u.get("pattern"));
  let route = int(u.get("route"));
  if (pattern !== null) {
    if (pattern >= tt.j.patterns.route.length) return bad("unknown pattern", 404);
    route = tt.j.patterns.route[pattern];
  }
  if (route === null || route >= tt.j.routes.id.length) return bad("route or pattern required", 404);
  const vehicles0 = routeVehicles(tt, route, Date.now()).map((v) => ({ ...v, rt: cachedRt(v.tripId, v.serviceDate) }));
  if (u.get("v") === "1") return json({ vehicles: vehicles0, now: Date.now() });
  const patterns = linePatterns(tt, route, pattern ?? undefined).map((lp) => ({ ...lp, geo: patternGeo(tt, lp.pattern) }));
  return json({ route: tt.routeInfo(route), routeIndex: route, patterns, vehicles: vehicles0, now: Date.now() });
}
