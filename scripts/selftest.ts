import { timetable } from "../lib/timetable";
import { plan } from "../lib/raptor";
import { departures, patternGeo, vehicles } from "../lib/schedule";
import { positionAt } from "../lib/vehicle-position";
import { localToMs, toLocal } from "../lib/time";

const tt = timetable();
const st = (n: string) => tt.j.stations.name.indexOf(n);
let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fail++; };

const day = toLocal(Date.now() + 864e5).ymd;
const t8 = localToMs(day, 8 * 3600);
const r = plan(tt, { from: st("Lyngby"), to: st("Lufthavnen"), timeMs: t8 });
check(r.length >= 3, `plan Lyngby→Lufthavnen returns ${r.length} options`);
check(r.every((i) => i.dep >= t8 - 60e3), "all options depart after requested time");
const ra = plan(tt, { from: st("Holte"), to: st("Kongens Nytorv"), timeMs: t8, arriveBy: true });
check(ra.length > 0 && ra.every((i) => i.arr <= t8) && t8 - ra[ra.length - 1].arr < 20 * 60e3, "arrive-by results arrive just before 08:00");
const d = departures(tt, st("Nørreport"), t8, 30);
check(d.length > 10 && d.every((x, i) => i === 0 || x.time >= d[i - 1].time), `departures sorted (${d.length})`);

const vs = vehicles(tt, [12.5, 55.64, 12.62, 55.72], t8);
check(vs.length > 20, `vehicles in central bbox at 08:00: ${vs.length}`);
let onRoute = 0, moved = 0;
for (const v of vs) {
  const g = patternGeo(tt, v.pattern);
  const a = positionAt(v, g, t8), b = positionAt(v, g, t8 + 30e3);
  if (!a || !b) continue;
  const near = g.coords.some(([x, y], i) => {
    if (i === 0) return false;
    const [x0, y0] = g.coords[i - 1], dx = x - x0, dy = y - y0, L = dx * dx + dy * dy || 1e-12;
    const u = Math.max(0, Math.min(1, ((a.lon - x0) * dx + (a.lat - y0) * dy) / L));
    return Math.hypot(a.lon - (x0 + u * dx), a.lat - (y0 + u * dy)) < 0.0005;
  });
  if (near) onRoute++;
  if (a.state === "moving" && (a.lon !== b.lon || a.lat !== b.lat)) moved++;
}
check(onRoute > 0.9 * vs.filter((v) => positionAt(v, patternGeo(tt, v.pattern), t8)).length, `vehicle positions lie on their routes (${onRoute})`);
check(moved > 5, `moving vehicles advance over 30 s (${moved})`);
const v0 = vs.find((v) => positionAt(v, patternGeo(tt, v.pattern), t8)?.state === "moving")!;
const g0 = patternGeo(tt, v0.pattern);
const p0 = positionAt(v0, g0, t8)!, pd = positionAt({ ...v0, rt: { delay: 180, live: true, at: Date.now(), source: "mock" } }, g0, t8)!;
check(p0.lon !== pd.lon || p0.lat !== pd.lat, "a 3-minute delay moves the vehicle back along its route");
check(pd.nextTime - p0.nextTime === 180e3 || pd.next !== p0.next, "delay shifts the expected arrival at the next stop");
process.exit(fail ? 1 : 0);
