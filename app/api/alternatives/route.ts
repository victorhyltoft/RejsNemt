import { timetable } from "@/lib/timetable";
import { directDepartures } from "@/lib/schedule";
import { buildLeg } from "@/lib/raptor";
import { withRealtime } from "@/lib/realtime";
import { bad, int, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const from = int(u.get("from")), to = int(u.get("to")), after = int(u.get("after"));
  const tt = timetable();
  if (from === null || to === null || from >= tt.j.stations.id.length || to >= tt.j.stations.id.length) return bad("from and to stations required");
  const opts = directDepartures(tt, from, to, after ?? Date.now(), 6);
  const withRt = await withRealtime(tt, from, opts.map((o) => o.dep));
  const legs = opts.map((o, k) => ({ leg: buildLeg(tt, o.p, o.t, o.bi, o.ai, o.dep.serviceDate), rt: withRt[k].rt ?? null }));
  return json({ options: legs, now: Date.now() });
}
