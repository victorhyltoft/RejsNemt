import type { Timetable } from "./timetable";
import type { Itinerary, Leg, StopRef, TransitLeg } from "./types";
import { serviceDayStartMs, toLocal } from "./time";

const INF = 0x7fffffff;
const MIN_CHANGE = 60;

interface Shift { day: number; ymd: string; shift: number }

export function stopRef(tt: Timetable, s: number): StopRef {
  const st = tt.j.stops.station[s];
  return { station: st, name: tt.j.stations.name[st], lat: tt.j.stops.lat[s], lon: tt.j.stops.lon[s], platform: tt.j.stops.platform[s] || undefined, where: tt.stopWhere(s) };
}

function earliestTrip(tt: Timetable, p: number, i: number, t: number, shifts: Shift[]) {
  const n = tt.j.patterns.nTrips[p];
  let best: { trip: number; dep: number; sh: number } | null = null;
  for (let si = 0; si < shifts.length; si++) {
    const { day, shift } = shifts[si];
    if (day < 0 || day >= tt.j.days) continue;
    const local = t - shift;
    let lo = 0, hi = n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (tt.dep(p, m, i) < local) lo = m + 1;
      else hi = m;
    }
    for (let tr = Math.max(0, lo - 3); tr < n; tr++) {
      const d = tt.dep(p, tr, i);
      if (d < local) continue;
      if (best && d + shift >= best.dep) break;
      if (tt.active(tt.serviceOf(p, tr), day)) {
        best = { trip: tr, dep: d + shift, sh: si };
        break;
      }
    }
  }
  return best;
}

interface Run {
  rounds: number;
  tau: Int32Array[];
  kind: Int8Array[];
  a: Int32Array[];
  b: Int32Array[];
  c: Int32Array[];
  d: Int32Array[];
  e: Int8Array[];
  r: Int8Array[];
}

function run(tt: Timetable, sources: { s: number; d: number }[], t0: number, targets: Map<number, number>, shifts: Shift[], maxRounds: number): Run {
  const S = tt.nStops;
  const R = maxRounds + 1;
  const mk = () => new Int32Array(S).fill(INF);
  const run: Run = { rounds: R, tau: [], kind: [], a: [], b: [], c: [], d: [], e: [], r: [] };
  for (let k = 0; k < R; k++) {
    run.tau.push(mk());
    run.kind.push(new Int8Array(S));
    run.a.push(new Int32Array(S));
    run.b.push(new Int32Array(S));
    run.c.push(new Int32Array(S));
    run.d.push(new Int32Array(S));
    run.e.push(new Int8Array(S));
    run.r.push(new Int8Array(S));
  }
  const star = mk();
  const starRound = new Int8Array(S);
  let bestTarget = INF;
  let marked = new Set<number>();
  const T = tt.j.transfers;

  for (const { s, d } of sources) {
    if (t0 + d >= star[s]) continue;
    run.tau[0][s] = t0 + d;
    run.kind[0][s] = 1;
    star[s] = t0 + d;
    marked.add(s);
  }
  for (const { s } of sources) {
    if (run.kind[0][s] !== 1) continue;
    for (let x = T.off[s]; x < T.off[s + 1]; x++) {
      const to = T.to[x], v = run.tau[0][s] + T.sec[x];
      if (v < star[to]) {
        run.tau[0][to] = v;
        run.kind[0][to] = 3;
        run.a[0][to] = s;
        star[to] = v;
        marked.add(to);
      }
    }
  }

  for (let k = 1; k < R; k++) {
    const prevBest = Int32Array.from(star);
    const prevRound = Int8Array.from(starRound);
    const Q = new Map<number, number>();
    for (const s of marked) {
      const ps = tt.patternsAtStop[s], pos = tt.patternStopPos[s];
      for (let x = 0; x < ps.length; x++) {
        const cur = Q.get(ps[x]);
        if (cur === undefined || pos[x] < cur) Q.set(ps[x], pos[x]);
      }
    }
    const byTrip: number[] = [];
    marked = new Set();
    const tau = run.tau[k];
    for (const [p, i0] of Q) {
      const n = tt.j.patterns.nStops[p];
      let trip = -1, sh = 0, shIdx = 0, board = -1, boardRound = 0;
      for (let i = i0; i < n; i++) {
        const s = tt.stopOf(p, i);
        if (trip >= 0) {
          const a = tt.arr(p, trip, i) + sh;
          if (a < star[s] && a < bestTarget) {
            tau[s] = a;
            star[s] = a;
            starRound[s] = k;
            run.kind[k][s] = 2;
            run.a[k][s] = p;
            run.b[k][s] = trip;
            run.c[k][s] = board;
            run.d[k][s] = i;
            run.e[k][s] = shIdx;
            run.r[k][s] = boardRound;
            if (!marked.has(s)) { marked.add(s); byTrip.push(s); }
            if (targets.has(s)) bestTarget = Math.min(bestTarget, a + targets.get(s)!);
          }
        }
        const prev = prevBest[s];
        if (prev === INF || i === n - 1) continue;
        const ready = prev + (k > 1 ? MIN_CHANGE : 0);
        if (trip >= 0 && ready > tt.dep(p, trip, i) + sh) continue;
        const f = earliestTrip(tt, p, i, ready, shifts);
        if (f && (trip < 0 || f.dep < tt.dep(p, trip, i) + sh)) {
          trip = f.trip;
          shIdx = f.sh;
          sh = shifts[f.sh].shift;
          board = i;
          boardRound = prevRound[s];
        }
      }
    }
    for (const s of byTrip) {
      const base = tau[s];
      for (let x = T.off[s]; x < T.off[s + 1]; x++) {
        const to = T.to[x], v = base + T.sec[x];
        if (v < star[to] && v < bestTarget) {
          tau[to] = v;
          star[to] = v;
          starRound[to] = k;
          run.kind[k][to] = 3;
          run.a[k][to] = s;
          marked.add(to);
          if (targets.has(to)) bestTarget = Math.min(bestTarget, v + targets.get(to)!);
        }
      }
    }
    if (!marked.size) {
      run.rounds = k + 1;
      break;
    }
  }
  return run;
}

export interface Origin { lat: number; lon: number; name: string }

export function buildLeg(tt: Timetable, p: number, trip: number, bi: number, ai: number, ymd: string): TransitLeg {
  const P = tt.j.patterns;
  const base = serviceDayStartMs(ymd);
  const ms = (v: number) => base + v * 1000;
  const stops: { name: string; time: number }[] = [];
  for (let i = bi; i <= ai; i++) stops.push({ name: tt.stationName(tt.stopOf(p, i)), time: ms(i === bi ? tt.dep(p, trip, i) : tt.arr(p, trip, i)) });
  return {
    type: "transit",
    route: tt.routeInfo(P.route[p]),
    headsign: P.headsign[p],
    tripId: tt.j.trips.id[tt.tripGlobal(p, trip)],
    serviceDate: ymd,
    pattern: p,
    fromIdx: bi,
    toIdx: ai,
    from: stopRef(tt, tt.stopOf(p, bi)),
    to: stopRef(tt, tt.stopOf(p, ai)),
    dep: ms(tt.dep(p, trip, bi)),
    arr: ms(tt.arr(p, trip, ai)),
    stops,
    shape: tt.shapePoints(p, bi, ai).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)] as [number, number]),
  };
}

function extract(tt: Timetable, rr: Run, k: number, s: number, shifts: Shift[], baseMs: number, t0: number, origin?: Origin): Itinerary | null {
  const legs: Leg[] = [];
  let cur = s, kk = k, guard = 0;
  const ms = (v: number) => baseMs + v * 1000;
  while (guard++ < 40) {
    const kind = rr.kind[kk][cur];
    if (kind === 1) {
      const w = rr.tau[kk][cur] - t0;
      if (origin && w > 0) legs.unshift({ type: "walk", from: { station: -1, name: origin.name, lat: origin.lat, lon: origin.lon }, to: stopRef(tt, cur), dep: ms(t0), arr: ms(rr.tau[kk][cur]) });
      break;
    }
    if (kind === 3) {
      const from = rr.a[kk][cur];
      legs.unshift({ type: "walk", from: stopRef(tt, from), to: stopRef(tt, cur), dep: ms(rr.tau[kk][from]), arr: ms(rr.tau[kk][cur]) });
      cur = from;
      continue;
    }
    if (kind === 2) {
      const p = rr.a[kk][cur], trip = rr.b[kk][cur], bi = rr.c[kk][cur], ai = rr.d[kk][cur], si = rr.e[kk][cur];
      legs.unshift(buildLeg(tt, p, trip, bi, ai, shifts[si].ymd));
      const br = rr.r[kk][cur];
      cur = tt.stopOf(p, bi);
      kk = br;
      continue;
    }
    return null;
  }
  while (legs.length && legs[0].type === "walk" && legs[0].from.station === legs[0].to.station) legs.shift();
  while (legs.length && legs[legs.length - 1].type === "walk" && legs[legs.length - 1].from.station === legs[legs.length - 1].to.station) legs.pop();
  const transit = legs.filter((l) => l.type === "transit");
  if (!transit.length) return null;
  if (legs[0].type === "walk" && legs[1]) {
    const d = legs[0].arr - legs[0].dep;
    legs[0].arr = legs[1].dep - MIN_CHANGE * 1000;
    legs[0].dep = legs[0].arr - d;
  }
  return { dep: legs[0].dep, arr: legs[legs.length - 1].arr, transfers: transit.length - 1, legs };
}

export interface PlanOptions {
  from: number | Origin;
  to: number | Origin;
  timeMs: number;
  arriveBy?: boolean;
  maxResults?: number;
}

export function plan(tt: Timetable, o: PlanOptions): Itinerary[] {
  const origin = typeof o.from === "number" ? undefined : o.from;
  const src = origin ? walkSources(tt, origin) : (tt.j.stations.stops[o.from as number] || []).map((s) => ({ s, d: 0 }));
  const dest = typeof o.to === "number" ? undefined : o.to;
  const targets = new Map<number, number>(dest ? walkSources(tt, dest).map((x) => [x.s, x.d]) : (tt.j.stations.stops[o.to as number] || []).map((s) => [s, 0]));
  if (!src.length || !targets.size || (typeof o.from === "number" && o.from === o.to)) return [];
  const want = o.maxResults ?? 5;
  let startMs = o.timeMs;
  if (o.arriveBy) {
    const probe = plan(tt, { ...o, arriveBy: false, timeMs: o.timeMs - 180 * 60e3, maxResults: 1 })[0];
    const d = probe ? probe.arr - probe.dep : 90 * 60e3;
    startMs = o.timeMs - d - 50 * 60e3;
  }
  const lt = toLocal(startMs);
  const shifts = tt.dayShifts(lt.ymd);
  const baseMs = serviceDayStartMs(lt.ymd);
  let t = Math.round((startMs - baseMs) / 1000);
  const found = new Map<string, Itinerary>();
  const limitMs = o.arriveBy ? o.timeMs : Infinity;
  for (let iter = 0; iter < (o.arriveBy ? 20 : 10); iter++) {
    const rr = run(tt, src, t, targets, shifts, 5);
    let prevBest = INF, nextT = INF;
    for (let k = 1; k < rr.rounds; k++) {
      let bs = -1, bv = INF;
      for (const [s, e] of targets) if (rr.tau[k][s] < INF && rr.tau[k][s] + e < bv) { bv = rr.tau[k][s] + e; bs = s; }
      if (bs < 0 || bv >= prevBest) continue;
      prevBest = bv;
      const it = extract(tt, rr, k, bs, shifts, baseMs, t, origin);
      if (!it) continue;
      const egress = targets.get(bs)!;
      if (dest && egress > 0) {
        const lastLeg = it.legs[it.legs.length - 1];
        it.legs.push({ type: "walk", from: lastLeg.to, to: { station: -1, name: dest.name, lat: dest.lat, lon: dest.lon }, dep: lastLeg.arr, arr: lastLeg.arr + egress * 1000 });
        it.arr = lastLeg.arr + egress * 1000;
      }
      const key = it.legs.filter((l) => l.type === "transit").map((l) => (l as any).tripId + "@" + l.dep).join("|");
      if (!found.has(key) && it.arr <= limitMs) found.set(key, it);
      const ft = it.legs.find((l) => l.type === "transit")!;
      nextT = Math.min(nextT, Math.round((ft.dep - baseMs) / 1000) - (origin ? Math.round((ft.dep - it.dep) / 1000) : 0) + 1);
    }
    if (nextT === INF) break;
    t = Math.max(t + 60, nextT);
    if (!o.arriveBy && found.size >= want + 2) break;
    if (o.arriveBy && baseMs + t * 1000 > o.timeMs) break;
  }
  let list = [...found.values()];
  list = list.filter((a) => !list.some((b) => b !== a && b.dep >= a.dep && b.arr <= a.arr && b.transfers <= a.transfers && (b.dep > a.dep || b.arr < a.arr || b.transfers < a.transfers)));
  const seen = new Set<string>();
  list = list.sort((a, b) => a.dep - b.dep || a.arr - b.arr || a.transfers - b.transfers).filter((i) => {
    const k = i.dep + ":" + i.arr;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return o.arriveBy ? list.slice(-want) : list.slice(0, want);
}

const WALK_MAX_M = 1000;
export function walkSources(tt: Timetable, o: Origin) {
  const out: { s: number; d: number }[] = [];
  const r = Math.PI / 180, kx = Math.cos(o.lat * r);
  const { lat, lon } = tt.j.stops;
  for (let s = 0; s < lat.length; s++) {
    const dy = (lat[s] - o.lat) * 111320, dx = (lon[s] - o.lon) * 111320 * kx;
    const m = Math.hypot(dx, dy);
    if (m <= WALK_MAX_M) out.push({ s, d: Math.round((m * 1.3) / 1.25) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 60);
}
