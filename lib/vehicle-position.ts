import type { PatternGeo, VehicleTrip } from "./types";

export interface VehiclePos {
  lon: number;
  lat: number;
  bearing: number;
  state: "waiting" | "moving" | "stopped";
  next: number;
  nextTime: number;
}

function pointAt(g: PatternGeo, d: number) {
  const { coords, cum } = g;
  if (d <= 0) return { lon: coords[0][0], lat: coords[0][1], i: 0 };
  let lo = 0, hi = cum.length - 1;
  if (d >= cum[hi]) return { lon: coords[hi][0], lat: coords[hi][1], i: hi - 1 };
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= d) lo = m; else hi = m;
  }
  const L = cum[hi] - cum[lo] || 1;
  const u = (d - cum[lo]) / L;
  return { lon: coords[lo][0] + (coords[hi][0] - coords[lo][0]) * u, lat: coords[lo][1] + (coords[hi][1] - coords[lo][1]) * u, i: lo };
}

function bearingOf(g: PatternGeo, i: number) {
  const a = g.coords[Math.min(i, g.coords.length - 2)], b = g.coords[Math.min(i + 1, g.coords.length - 1)];
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

export function positionAt(v: VehicleTrip, g: PatternGeo, nowMs: number): VehiclePos | null {
  if (v.rt?.cancelled) return null;
  const delay = v.rt?.delay ?? 0;
  const t = (nowMs - v.base) / 1000 - delay;
  const n = v.times.length / 2;
  const arr = (i: number) => v.times[2 * i], dep = (i: number) => v.times[2 * i + 1];
  const exp = (i: number) => v.base + (arr(i) + delay) * 1000;
  if (t < dep(0)) {
    if (dep(0) - t > 120) return null;
    const p = pointAt(g, g.stopDist[0]);
    return { lon: p.lon, lat: p.lat, bearing: bearingOf(g, p.i), state: "waiting", next: 0, nextTime: v.base + (dep(0) + delay) * 1000 };
  }
  if (t > arr(n - 1) + 30) return null;
  for (let i = 0; i < n - 1; i++) {
    if (t < dep(i)) {
      const p = pointAt(g, g.stopDist[i]);
      return { lon: p.lon, lat: p.lat, bearing: bearingOf(g, p.i), state: "stopped", next: i, nextTime: exp(i) };
    }
    if (t < arr(i + 1)) {
      const span = arr(i + 1) - dep(i) || 1;
      const u = (t - dep(i)) / span;
      const d = g.stopDist[i] + (g.stopDist[i + 1] - g.stopDist[i]) * u;
      const p = pointAt(g, d);
      return { lon: p.lon, lat: p.lat, bearing: bearingOf(g, p.i), state: "moving", next: i + 1, nextTime: exp(i + 1) };
    }
  }
  const p = pointAt(g, g.stopDist[n - 1]);
  return { lon: p.lon, lat: p.lat, bearing: bearingOf(g, p.i), state: "stopped", next: n - 1, nextTime: exp(n - 1) };
}
