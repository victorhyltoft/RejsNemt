import fs from "node:fs";
import path from "node:path";
import type { TimetableJson } from "./format";
import { addDays, dayDiff, serviceDayStartMs } from "./time";

export class Timetable {
  j: TimetableJson;
  times: Int32Array;
  shapeXY: Float32Array;
  dists: Float32Array;
  services: Uint8Array;
  patternsAtStop: number[][];
  patternStopPos: number[][];
  stationByStopId = new Map<string, number>();
  private _tripIndex: Map<string, number> | null = null;
  private _tripPattern: Int32Array | null = null;

  constructor(dir: string) {
    this.j = JSON.parse(fs.readFileSync(path.join(dir, "timetable.json"), "utf8"));
    const rd = (f: string) => {
      const b = fs.readFileSync(path.join(dir, f));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    this.times = new Int32Array(rd("times.bin"));
    this.shapeXY = new Float32Array(rd("shapes.bin"));
    this.dists = new Float32Array(rd("dists.bin"));
    this.services = new Uint8Array(Buffer.from(this.j.services, "base64"));
    const S = this.j.stops.id.length;
    this.patternsAtStop = Array.from({ length: S }, () => []);
    this.patternStopPos = Array.from({ length: S }, () => []);
    const P = this.j.patterns;
    for (let p = 0; p < P.route.length; p++) {
      for (let i = 0; i < P.nStops[p]; i++) {
        const s = this.j.patternStops[P.stopOff[p] + i];
        this.patternsAtStop[s].push(p);
        this.patternStopPos[s].push(i);
      }
    }
    this.j.stations.id.forEach((id, k) => this.stationByStopId.set(id, k));
  }

  tripIndex(id: string) {
    if (!this._tripIndex) {
      this._tripIndex = new Map();
      this.j.trips.id.forEach((x, i) => this._tripIndex!.set(x, i));
    }
    return this._tripIndex.get(id);
  }

  tripPattern(g: number) {
    if (!this._tripPattern) {
      const P = this.j.patterns;
      this._tripPattern = new Int32Array(this.j.trips.id.length);
      for (let p = 0; p < P.route.length; p++) for (let t = 0; t < P.nTrips[p]; t++) this._tripPattern[P.tripOff[p] + t] = p;
    }
    const p = this._tripPattern[g];
    return { p, t: g - this.j.patterns.tripOff[p] };
  }

  get nStops() {
    return this.j.stops.id.length;
  }

  dayIndex(ymd: string) {
    return dayDiff(this.j.feedStart, ymd);
  }

  active(svc: number, day: number) {
    if (day < 0 || day >= this.j.days) return false;
    return (this.services[svc * this.j.serviceBytes + (day >> 3)] & (1 << (day & 7))) !== 0;
  }

  stopOf(p: number, i: number) {
    return this.j.patternStops[this.j.patterns.stopOff[p] + i];
  }

  arr(p: number, t: number, i: number) {
    return this.times[this.j.patterns.timeOff[p] + (t * this.j.patterns.nStops[p] + i) * 2];
  }

  dep(p: number, t: number, i: number) {
    return this.times[this.j.patterns.timeOff[p] + (t * this.j.patterns.nStops[p] + i) * 2 + 1];
  }

  tripGlobal(p: number, t: number) {
    return this.j.patterns.tripOff[p] + t;
  }

  serviceOf(p: number, t: number) {
    return this.j.trips.service[this.j.patterns.tripOff[p] + t];
  }

  dayShifts(ymd: string) {
    const base = serviceDayStartMs(ymd);
    return [-1, 0, 1].map((o) => {
      const d = addDays(ymd, o);
      return { day: this.dayIndex(d), ymd: d, shift: Math.round((serviceDayStartMs(d) - base) / 1000) };
    });
  }

  routeInfo(r: number) {
    const R = this.j.routes;
    return { short: R.short[r], long: R.long[r], mode: R.mode[r], color: R.color[r], text: R.text[r] };
  }

  stationName(s: number) {
    return this.j.stations.name[this.j.stops.station[s]];
  }

  /** Which part of a merged hub a stop is, e.g. "Jernbanepladsen" for "Lyngby St. (Jernbanepladsen)". */
  stopWhere(s: number): string | undefined {
    const own = this.j.stops.name[s], st = this.stationName(s);
    if (own === st) return undefined;
    const m = own.match(/\(([^()]*)\)\s*$/);
    if (!m) return undefined;
    if (/^togbus$/i.test(m[1])) return "Togbus";
    if (/^(metro|letbane|s-tog|tog|bus)$/i.test(m[1])) return undefined;
    return m[1];
  }

  shapePoints(p: number, fromIdx = 0, toIdx = -1): [number, number][] {
    const P = this.j.patterns;
    const sh = P.shape[p];
    const off = this.j.shapes.off[sh], n = this.j.shapes.n[sh];
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) pts.push([this.shapeXY[(off + k) * 2 + 1], this.shapeXY[(off + k) * 2]]);
    if (fromIdx === 0 && toIdx < 0) return pts;
    const d0 = this.dists[P.distOff[p] + fromIdx];
    const d1 = this.dists[P.distOff[p] + (toIdx < 0 ? P.nStops[p] - 1 : toIdx)];
    return slicePolyline(pts, d0, d1);
  }

  stopDists(p: number) {
    const P = this.j.patterns;
    return Array.from(this.dists.subarray(P.distOff[p], P.distOff[p] + P.nStops[p]));
  }
}

function hav(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dA = (b[1] - a[1]) * r, dO = (b[0] - a[0]) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dO / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

export function slicePolyline(pts: [number, number][], d0: number, d1: number): [number, number][] {
  const out: [number, number][] = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = hav(pts[i], pts[i + 1]);
    const a = acc, b = acc + L;
    if (b >= d0 && a <= d1) {
      const lerp = (d: number): [number, number] => {
        const u = L ? Math.max(0, Math.min(1, (d - a) / L)) : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
      };
      if (!out.length) out.push(lerp(Math.max(d0, a)));
      out.push(lerp(Math.min(d1, b)));
    }
    acc = b;
    if (acc > d1) break;
  }
  return out.length > 1 ? out : pts.slice(0, 2);
}

let cached: Timetable | null = null;
export function timetable(): Timetable {
  if (!cached) cached = new Timetable(path.join(process.cwd(), "data"));
  return cached;
}
