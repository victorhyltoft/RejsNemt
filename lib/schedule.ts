import type { Timetable } from "./timetable";
import type { Departure, PatternGeo, VehicleTrip } from "./types";
import { serviceDayStartMs, toLocal } from "./time";

export function departures(tt: Timetable, station: number, timeMs: number, windowMin = 90, limit = 40): Departure[] {
  const stops = tt.j.stations.stops[station] || [];
  const lt = toLocal(timeMs);
  const shifts = tt.dayShifts(lt.ymd);
  const out: Departure[] = [];
  const P = tt.j.patterns;
  for (const s of stops) {
    const ps = tt.patternsAtStop[s], pos = tt.patternStopPos[s];
    for (let x = 0; x < ps.length; x++) {
      const p = ps[x], i = pos[x];
      if (i === P.nStops[p] - 1) continue;
      for (const sh of shifts) {
        if (sh.day < 0 || sh.day >= tt.j.days) continue;
        const from = lt.secs - sh.shift - 60, to = from + windowMin * 60;
        const n = P.nTrips[p];
        let lo = 0, hi = n;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (tt.dep(p, m, i) < from) lo = m + 1; else hi = m;
        }
        const base = serviceDayStartMs(sh.ymd);
        for (let t = Math.max(0, lo - 2); t < n; t++) {
          const d = tt.dep(p, t, i);
          if (d < from) continue;
          if (d > to) break;
          if (!tt.active(tt.serviceOf(p, t), sh.day)) continue;
          out.push({
            tripId: tt.j.trips.id[tt.tripGlobal(p, t)],
            serviceDate: sh.ymd,
            route: tt.routeInfo(P.route[p]),
            headsign: P.headsign[p],
            time: base + d * 1000,
            platform: tt.j.stops.platform[s] || undefined,
            where: tt.stopWhere(s),
            stop: s,
            pattern: p,
            idx: i,
          });
        }
      }
    }
  }
  out.sort((a, b) => a.time - b.time);
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.tripId + d.serviceDate) ? false : (seen.add(d.tripId + d.serviceDate), true))).slice(0, limit);
}

export function tripTimes(tt: Timetable, p: number, t: number) {
  const n = tt.j.patterns.nStops[p];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(tt.arr(p, t, i), tt.dep(p, t, i));
  return out;
}

export function vehicles(tt: Timetable, bbox: [number, number, number, number], nowMs: number, max = 400): VehicleTrip[] {
  const [w, s, e, n] = bbox;
  const lt = toLocal(nowMs);
  const shifts = tt.dayShifts(lt.ymd);
  const P = tt.j.patterns;
  const out: VehicleTrip[] = [];
  for (let p = 0; p < P.route.length && out.length < max; p++) {
    const b = P.bbox[p];
    if (b[0] > n || b[2] < s || b[1] > e || b[3] < w) continue;
    const ns = P.nStops[p], nt = P.nTrips[p];
    for (const sh of shifts) {
      if (sh.day < 0 || sh.day >= tt.j.days) continue;
      const now = lt.secs - sh.shift;
      let lo = 0, hi = nt;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (tt.dep(p, m, 0) < now - 6 * 3600) lo = m + 1; else hi = m;
      }
      const base = serviceDayStartMs(sh.ymd);
      for (let t = lo; t < nt; t++) {
        const d0 = tt.dep(p, t, 0);
        if (d0 > now + 60) break;
        if (tt.arr(p, t, ns - 1) < now - 60) continue;
        if (!tt.active(tt.serviceOf(p, t), sh.day)) continue;
        out.push({
          tripId: tt.j.trips.id[tt.tripGlobal(p, t)],
          serviceDate: sh.ymd,
          pattern: p,
          route: tt.routeInfo(P.route[p]),
          headsign: P.headsign[p],
          base,
          times: tripTimes(tt, p, t),
        });
        if (out.length >= max) break;
      }
    }
  }
  return out;
}

export function tripById(tt: Timetable, id: string, ymd: string): VehicleTrip | null {
  const g = tt.tripIndex(id);
  if (g === undefined) return null;
  const { p, t } = tt.tripPattern(g);
  const P = tt.j.patterns;
  return { tripId: id, serviceDate: ymd, pattern: p, route: tt.routeInfo(P.route[p]), headsign: P.headsign[p], base: serviceDayStartMs(ymd), times: tripTimes(tt, p, t) };
}

function lengthOf(c: [number, number][]) {
  const cum = [0];
  const r = Math.PI / 180;
  for (let i = 1; i < c.length; i++) {
    const [o1, a1] = c[i - 1], [o2, a2] = c[i];
    const h = Math.sin(((a2 - a1) * r) / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(((o2 - o1) * r) / 2) ** 2;
    cum.push(Math.round(cum[i - 1] + 12742000 * Math.asin(Math.sqrt(h))));
  }
  return cum;
}

function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const u = L ? ((pts[i][0] - x1) * dx + (pts[i][1] - y1) * dy) / L : 0;
      const ex = pts[i][0] - (x1 + u * dx), ey = pts[i][1] - (y1 + u * dy);
      const d = ex * ex + ey * ey;
      if (d > md) { md = d; mi = i; }
    }
    if (mi > 0 && md > tol * tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function patternGeo(tt: Timetable, p: number): PatternGeo {
  const raw = tt.shapePoints(p);
  const rawLen = lengthOf(raw).pop() || 1;
  const coords = simplify(raw, 0.00004).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as [number, number]);
  const cum = lengthOf(coords);
  const k = (cum[cum.length - 1] || 1) / rawLen;
  const n = tt.j.patterns.nStops[p];
  const stops = [];
  for (let i = 0; i < n; i++) {
    const s = tt.stopOf(p, i);
    stops.push({ name: tt.stationName(s), lat: tt.j.stops.lat[s], lon: tt.j.stops.lon[s] });
  }
  return { pattern: p, coords, cum, stopDist: tt.stopDists(p).map((d) => Math.round(d * k)), stops };
}

export interface LinePattern {
  pattern: number;
  headsign: string;
  from: string;
  trips: number;
}

export function linePatterns(tt: Timetable, route: number, prefer?: number): LinePattern[] {
  const P = tt.j.patterns;
  const all: LinePattern[] = [];
  for (let p = 0; p < P.route.length; p++) {
    if (P.route[p] !== route) continue;
    all.push({ pattern: p, headsign: P.headsign[p], from: tt.stationName(tt.stopOf(p, 0)), trips: P.nTrips[p] });
  }
  all.sort((a, b) => b.trips - a.trips || P.nStops[b.pattern] - P.nStops[a.pattern]);
  const out: LinePattern[] = [];
  const seen = new Set<string>();
  if (prefer !== undefined) {
    const x = all.find((a) => a.pattern === prefer);
    if (x) { out.push(x); seen.add(x.from + ">" + x.headsign); }
  }
  for (const a of all) {
    const k = a.from + ">" + a.headsign;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
    if (out.length >= 6) break;
  }
  return out;
}

export function routeVehicles(tt: Timetable, route: number, nowMs: number, max = 150): VehicleTrip[] {
  const P = tt.j.patterns;
  const lt = toLocal(nowMs);
  const shifts = tt.dayShifts(lt.ymd);
  const out: VehicleTrip[] = [];
  for (let p = 0; p < P.route.length && out.length < max; p++) {
    if (P.route[p] !== route) continue;
    const ns = P.nStops[p], nt = P.nTrips[p];
    for (const sh of shifts) {
      if (sh.day < 0 || sh.day >= tt.j.days) continue;
      const now = lt.secs - sh.shift;
      const base = serviceDayStartMs(sh.ymd);
      for (let t = 0; t < nt; t++) {
        const d0 = tt.dep(p, t, 0);
        if (d0 > now + 60) break;
        if (tt.arr(p, t, ns - 1) < now - 60) continue;
        if (!tt.active(tt.serviceOf(p, t), sh.day)) continue;
        out.push({ tripId: tt.j.trips.id[tt.tripGlobal(p, t)], serviceDate: sh.ymd, pattern: p, route: tt.routeInfo(P.route[p]), headsign: P.headsign[p], base, times: tripTimes(tt, p, t) });
      }
    }
  }
  return out;
}

export function directDepartures(tt: Timetable, fromStation: number, toStation: number, afterMs: number, n = 6) {
  const deps = departures(tt, fromStation, afterMs, 120, 300);
  const out: { dep: Departure; p: number; t: number; bi: number; ai: number }[] = [];
  const toStops = new Set(tt.j.stations.stops[toStation] || []);
  for (const d of deps) {
    const n2 = tt.j.patterns.nStops[d.pattern];
    let ai = -1;
    for (let j = d.idx + 1; j < n2; j++) if (toStops.has(tt.stopOf(d.pattern, j))) { ai = j; break; }
    if (ai < 0) continue;
    const g = tt.tripIndex(d.tripId);
    if (g === undefined) continue;
    const { t } = tt.tripPattern(g);
    out.push({ dep: d, p: d.pattern, t, bi: d.idx, ai });
    if (out.length >= n) break;
  }
  return out;
}
