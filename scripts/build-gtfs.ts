import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import yauzl from "yauzl";
import { parse } from "csv-parse";
import { FORMAT_VERSION, type NetworkJson, type TimetableJson } from "../lib/format";
import { MODE_BIT, lineColors, modeFromRouteType, type Mode } from "../lib/modes";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const PUB = path.join(ROOT, "public", "data");
const args = process.argv.slice(2);
const argVal = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

const BBOX = { minLat: 54.55, maxLat: 56.15, minLon: 10.85, maxLon: 12.75 };
const MAX_DAYS = 100;
const WALK_RADIUS_M = 400;
const WALK_SPEED = 1.2;
const SAME_STATION_SEC = 120;

const inBox = (la: number, lo: number) => la >= BBOX.minLat && la <= BBOX.maxLat && lo >= BBOX.minLon && lo <= BBOX.maxLon;

function haversine(a1: number, o1: number, a2: number, o2: number) {
  const r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

const toSec = (s: string) => {
  if (!s) return -1;
  const [h, m, x] = s.trim().split(":").map(Number);
  return h * 3600 + m * 60 + (x || 0);
};

const ymdToDate = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
const dateToYmd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function download(url: string, dest: string) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest));
  console.log(`Saved ${(fs.statSync(dest).size / 1e6).toFixed(1)} MB`);
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((ok, fail) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => (e ? fail(e) : ok(z!))));
}

async function listEntries(zip: yauzl.ZipFile) {
  const map = new Map<string, yauzl.Entry>();
  await new Promise<void>((ok, fail) => {
    zip.on("entry", (e: yauzl.Entry) => {
      map.set(path.basename(e.fileName), e);
      zip.readEntry();
    });
    zip.on("end", () => ok());
    zip.on("error", fail);
    zip.readEntry();
  });
  return map;
}

async function readCsv(zip: yauzl.ZipFile, entries: Map<string, yauzl.Entry>, name: string, onRow: (r: Record<string, string>) => void) {
  const e = entries.get(name);
  if (!e) return false;
  const stream: Readable = await new Promise((ok, fail) => zip.openReadStream(e, (err, s) => (err ? fail(err) : ok(s!))));
  const parser = stream.pipe(parse({ columns: (h: string[]) => h.map((x) => x.replace(/^﻿/, "").trim()), bom: true, relax_quotes: true, skip_empty_lines: true, trim: true }));
  let n = 0;
  for await (const row of parser) {
    onRow(row);
    if (++n % 1_000_000 === 0) console.log(`  ${name}: ${n / 1e6}M rows`);
  }
  return true;
}

async function main() {
  const outFile = path.join(DATA, "timetable.json");
  if (args.includes("--if-missing") && fs.existsSync(outFile)) {
    const age = (Date.now() - fs.statSync(outFile).mtimeMs) / 864e5;
    if (age < 6 || process.env.GTFS_SKIP === "1") {
      console.log(`Timetable is ${age.toFixed(1)} days old, keeping it.`);
      return;
    }
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(PUB, { recursive: true });

  let zipPath = argVal("--file");
  const source = zipPath ? path.basename(zipPath) : process.env.GTFS_URL || "https://www.rejseplanen.info/labs/GTFS.zip";
  if (!zipPath) {
    zipPath = path.join(process.env.TMPDIR || "/tmp", "afsted-gtfs.zip");
    await download(source, zipPath);
  }
  const zip = await openZip(zipPath);
  const entries = await listEntries(zip);

  const stopRow: { id: string; name: string; lat: number; lon: number; parent: string; type: number; platform: string }[] = [];
  const stopIdx = new Map<string, number>();
  await readCsv(zip, entries, "stops.txt", (r) => {
    stopIdx.set(r.stop_id, stopRow.length);
    stopRow.push({ id: r.stop_id, name: r.stop_name, lat: +r.stop_lat, lon: +r.stop_lon, parent: r.parent_station || "", type: +(r.location_type || 0), platform: r.platform_code || "" });
  });
  console.log(`stops: ${stopRow.length}`);

  const routeRow = new Map<string, { short: string; long: string; type: number; color: string; text: string }>();
  await readCsv(zip, entries, "routes.txt", (r) => {
    routeRow.set(r.route_id, { short: r.route_short_name || r.route_long_name || "?", long: r.route_long_name || "", type: +r.route_type, color: r.route_color || "", text: r.route_text_color || "" });
  });

  const tripRow = new Map<string, { route: string; service: string; headsign: string; shape: string }>();
  await readCsv(zip, entries, "trips.txt", (r) => {
    tripRow.set(r.trip_id, { route: r.route_id, service: r.service_id, headsign: r.trip_headsign || "", shape: r.shape_id || "" });
  });
  console.log(`trips in feed: ${tripRow.size}`);

  const cal = new Map<string, { days: number[]; start: string; end: string }>();
  const calEx: { service: string; date: string; type: number }[] = [];
  await readCsv(zip, entries, "calendar.txt", (r) => {
    cal.set(r.service_id, { days: [r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday, r.sunday].map(Number), start: r.start_date, end: r.end_date });
  });
  await readCsv(zip, entries, "calendar_dates.txt", (r) => calEx.push({ service: r.service_id, date: r.date, type: +r.exception_type }));

  let minD = "99999999", maxD = "00000000";
  for (const c of cal.values()) { if (c.start < minD) minD = c.start; if (c.end > maxD) maxD = c.end; }
  for (const x of calEx) { if (x.date < minD) minD = x.date; if (x.date > maxD) maxD = x.date; }
  const today = dateToYmd(new Date(Date.now() - 2 * 864e5));
  const feedStart = minD > today ? minD : today;
  const days = Math.max(1, Math.min(MAX_DAYS, Math.round((ymdToDate(maxD).getTime() - ymdToDate(feedStart).getTime()) / 864e5) + 1));
  const startDate = ymdToDate(feedStart);
  console.log(`calendar ${minD}–${maxD}, using ${feedStart} + ${days} days`);

  const serviceBytes = Math.ceil(days / 8);
  const serviceBits = new Map<string, Uint8Array>();
  const bitsFor = (s: string) => {
    let b = serviceBits.get(s);
    if (!b) { b = new Uint8Array(serviceBytes); serviceBits.set(s, b); }
    return b;
  };
  for (const [s, c] of cal) {
    const b = bitsFor(s);
    for (let d = 0; d < days; d++) {
      const dt = new Date(startDate.getTime() + d * 864e5);
      const ymd = dateToYmd(dt);
      if (ymd < c.start || ymd > c.end) continue;
      if (c.days[(dt.getUTCDay() + 6) % 7]) b[d >> 3] |= 1 << (d & 7);
    }
  }
  for (const x of calEx) {
    const d = Math.round((ymdToDate(x.date).getTime() - startDate.getTime()) / 864e5);
    if (d < 0 || d >= days) continue;
    const b = bitsFor(x.service);
    if (x.type === 1) b[d >> 3] |= 1 << (d & 7);
    else b[d >> 3] &= ~(1 << (d & 7));
  }

  const keptStops = new Map<number, number>();
  const keepStop = (gi: number) => {
    let k = keptStops.get(gi);
    if (k === undefined) { k = keptStops.size; keptStops.set(gi, k); }
    return k;
  };

  type Pat = { route: string; headsign: string; shape: string; stops: number[]; trips: { id: string; service: string; times: number[] }[] };
  const patterns = new Map<string, Pat>();
  let cur: { id: string; seq: number[]; stops: number[]; arr: number[]; dep: number[] } | null = null;
  const seen = new Set<string>();
  let kept = 0, dropped = 0, reopened = 0;

  const finish = () => {
    if (!cur) return;
    const t = cur;
    cur = null;
    const tr = tripRow.get(t.id);
    if (!tr || !serviceBits.has(tr.service)) { dropped++; return; }
    const ord = t.seq.map((s, i) => [s, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const st = ord.map((i) => t.stops[i]), arr = ord.map((i) => t.arr[i]), dep = ord.map((i) => t.dep[i]);
    if (st.length < 2 || !st.some((g) => inBox(stopRow[g].lat, stopRow[g].lon))) { dropped++; return; }
    for (let i = 0; i < st.length; i++) {
      if (arr[i] < 0) arr[i] = dep[i];
      if (dep[i] < 0) dep[i] = arr[i];
    }
    for (let i = 0; i < st.length; i++) {
      if (arr[i] >= 0) continue;
      let a = i - 1; while (a >= 0 && arr[a] < 0) a--;
      let b = i + 1; while (b < st.length && arr[b] < 0) b++;
      if (a < 0 || b >= st.length) { dropped++; return; }
      const v = Math.round(dep[a] + ((arr[b] - dep[a]) * (i - a)) / (b - a));
      arr[i] = dep[i] = v;
    }
    const ks = st.map(keepStop);
    const key = `${tr.route}|${tr.shape}|${ks.join(",")}`;
    let p = patterns.get(key);
    if (!p) { p = { route: tr.route, headsign: tr.headsign, shape: tr.shape, stops: ks, trips: [] }; patterns.set(key, p); }
    const times: number[] = [];
    for (let i = 0; i < ks.length; i++) times.push(arr[i], dep[i]);
    p.trips.push({ id: t.id, service: tr.service, times });
    kept++;
  };

  await readCsv(zip, entries, "stop_times.txt", (r) => {
    if (!cur || cur.id !== r.trip_id) {
      finish();
      if (seen.has(r.trip_id)) reopened++;
      seen.add(r.trip_id);
      cur = { id: r.trip_id, seq: [], stops: [], arr: [], dep: [] };
    }
    const gi = stopIdx.get(r.stop_id);
    if (gi === undefined) return;
    cur.seq.push(+r.stop_sequence);
    cur.stops.push(gi);
    cur.arr.push(toSec(r.arrival_time));
    cur.dep.push(toSec(r.departure_time));
  });
  finish();
  if (reopened) console.warn(`warning: ${reopened} trips were not contiguous in stop_times.txt`);
  console.log(`kept trips: ${kept}, dropped: ${dropped}, patterns: ${patterns.size}, stops: ${keptStops.size}`);

  const neededShapes = new Set<string>();
  for (const p of patterns.values()) if (p.shape) neededShapes.add(p.shape);
  const shapePts = new Map<string, { seq: number; lat: number; lon: number }[]>();
  await readCsv(zip, entries, "shapes.txt", (r) => {
    if (!neededShapes.has(r.shape_id)) return;
    let a = shapePts.get(r.shape_id);
    if (!a) { a = []; shapePts.set(r.shape_id, a); }
    a.push({ seq: +r.shape_pt_sequence, lat: +r.shape_pt_lat, lon: +r.shape_pt_lon });
  });
  zip.close();
  console.log(`shapes: ${shapePts.size}/${neededShapes.size}`);

  const gStops = [...keptStops.keys()];
  const S = gStops.length;
  const sId: string[] = [], sName: string[] = [], sLat: number[] = [], sLon: number[] = [], sPlat: string[] = [];
  for (const g of gStops) {
    const s = stopRow[g];
    sId.push(s.id); sName.push(s.name); sLat.push(+s.lat.toFixed(6)); sLon.push(+s.lon.toFixed(6)); sPlat.push(s.platform);
  }

  const stationKey: string[] = new Array(S);
  const cleanName = (n: string) => n.replace(/\s*\((spor|perron|stoppested|platform)[^)]*\)\s*$/i, "").replace(/\s+(spor|perron)\s+\S+$/i, "").trim();
  const cellOf = (la: number, lo: number) => `${Math.floor(la * 200)}:${Math.floor(lo * 110)}`;
  const byNameCell = new Map<string, number[]>();
  for (let i = 0; i < S; i++) {
    const g = stopRow[gStops[i]];
    if (g.parent && stopIdx.has(g.parent)) { stationKey[i] = "P:" + g.parent; continue; }
    const n = cleanName(g.name).toLowerCase();
    const k = n + "@" + cellOf(g.lat, g.lon);
    stationKey[i] = "";
    const near: number[] = [];
    const [ca, co] = [Math.floor(g.lat * 200), Math.floor(g.lon * 110)];
    for (let da = -1; da <= 1; da++) for (let dd = -1; dd <= 1; dd++) {
      const arr = byNameCell.get(`${n}@${ca + da}:${co + dd}`);
      if (arr) near.push(...arr);
    }
    const hit = near.find((j) => haversine(g.lat, g.lon, sLat[j], sLon[j]) < 400);
    stationKey[i] = hit !== undefined ? stationKey[hit] : "N:" + i;
    let list = byNameCell.get(k);
    if (!list) { list = []; byNameCell.set(k, list); }
    list.push(i);
  }
  const keyStop = (key: string) => (key.startsWith("P:") ? stopRow[stopIdx.get(key.slice(2))!] : stopRow[gStops[+key.slice(2)]]);

  const stopModes = new Array<number>(S).fill(0);
  for (const p of patterns.values()) {
    const r = routeRow.get(p.route);
    const bit = MODE_BIT[modeFromRouteType(r ? r.type : 3, r?.short)];
    for (const s of p.stops) stopModes[s] |= bit;
  }
  const hubs = mergeHubs(stationKey, (k) => cleanName(keyStop(k).name), sLat, sLon, stopModes);
  for (let i = 0; i < S; i++) stationKey[i] = hubs.remap.get(stationKey[i]) ?? stationKey[i];
  console.log(`hubs: merged ${hubs.remap.size} stations into ${hubs.names.size} hubs`);

  const stIdx = new Map<string, number>();
  const stationOf: number[] = new Array(S);
  const st = { id: [] as string[], name: [] as string[], lat: [] as number[], lon: [] as number[], stops: [] as number[][], modes: [] as number[], routes: [] as number[][] };
  for (let i = 0; i < S; i++) {
    let k = stIdx.get(stationKey[i]);
    if (k === undefined) {
      k = st.id.length;
      stIdx.set(stationKey[i], k);
      const ks = keyStop(stationKey[i]);
      st.id.push(ks.id);
      st.name.push(hubs.names.get(stationKey[i]) ?? cleanName(ks.name));
      st.lat.push(0); st.lon.push(0); st.stops.push([]); st.modes.push(0); st.routes.push([]);
    }
    stationOf[i] = k;
    st.stops[k].push(i);
  }
  for (let k = 0; k < st.id.length; k++) {
    const ss = st.stops[k];
    st.lat[k] = +(ss.reduce((a, i) => a + sLat[i], 0) / ss.length).toFixed(6);
    st.lon[k] = +(ss.reduce((a, i) => a + sLon[i], 0) / ss.length).toFixed(6);
  }

  const routeIds = [...new Set([...patterns.values()].map((p) => p.route))];
  const rIdx = new Map(routeIds.map((r, i) => [r, i]));
  const routes = { id: [] as string[], short: [] as string[], long: [] as string[], mode: [] as Mode[], color: [] as string[], text: [] as string[] };
  for (const r of routeIds) {
    const x = routeRow.get(r) || { short: "?", long: "", type: 3, color: "", text: "" };
    const mode = modeFromRouteType(x.type, x.short);
    const [c, t] = lineColors(x.short, mode, x.color, x.text);
    routes.id.push(r); routes.short.push(x.short); routes.long.push(x.long); routes.mode.push(mode); routes.color.push(c); routes.text.push(t);
  }

  const svcIds = [...new Set([...patterns.values()].flatMap((p) => p.trips.map((t) => t.service)))];
  const svcIdx = new Map(svcIds.map((s, i) => [s, i]));
  const svcBuf = Buffer.alloc(svcIds.length * serviceBytes);
  svcIds.forEach((s, i) => Buffer.from(serviceBits.get(s)!).copy(svcBuf, i * serviceBytes));

  const shapeKeys: string[] = [];
  const shapeIdx = new Map<string, number>();
  const shapeCoords: number[] = [];
  const shapes = { off: [] as number[], n: [] as number[] };
  const addShape = (key: string, pts: [number, number][]) => {
    let k = shapeIdx.get(key);
    if (k !== undefined) return k;
    k = shapeKeys.length;
    shapeKeys.push(key);
    shapeIdx.set(key, k);
    shapes.off.push(shapeCoords.length / 2);
    shapes.n.push(pts.length);
    for (const [la, lo] of pts) shapeCoords.push(la, lo);
    return k;
  };

  const P = { route: [] as number[], headsign: [] as string[], stopOff: [] as number[], nStops: [] as number[], tripOff: [] as number[], nTrips: [] as number[], timeOff: [] as number[], shape: [] as number[], distOff: [] as number[], bbox: [] as number[][] };
  const patternStops: number[] = [];
  const trips = { id: [] as string[], service: [] as number[] };
  const times: number[] = [];
  const dists: number[] = [];

  for (const p of patterns.values()) {
    p.trips.sort((a, b) => a.times[1] - b.times[1]);
    const ri = rIdx.get(p.route)!;
    const sp = shapePts.get(p.shape);
    let pts: [number, number][];
    let key: string;
    if (sp && sp.length > 1) {
      sp.sort((a, b) => a.seq - b.seq);
      pts = sp.map((x) => [x.lat, x.lon]);
      key = "S:" + p.shape;
    } else {
      pts = p.stops.map((i) => [sLat[i], sLon[i]]);
      key = "L:" + p.stops.join(",");
    }
    const shp = addShape(key, pts);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    P.distOff.push(dists.length);
    let from = 0;
    for (const s of p.stops) {
      let best = Infinity, bestD = cum[from];
      for (let j = from; j < pts.length - 1; j++) {
        const [a1, o1] = pts[j], [a2, o2] = pts[j + 1];
        const kx = Math.cos((a1 * Math.PI) / 180);
        const dx = (o2 - o1) * kx, dy = a2 - a1, px = (sLon[s] - o1) * kx, py = sLat[s] - a1;
        const L = dx * dx + dy * dy;
        const u = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0;
        const ex = px - u * dx, ey = py - u * dy;
        const d = ex * ex + ey * ey;
        if (d < best) { best = d; bestD = cum[j] + u * (cum[j + 1] - cum[j]); from = j; }
        if (best < 1e-9 && j > from + 50) break;
      }
      dists.push(Math.round(bestD));
    }
    let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
    for (const [la, lo] of pts) { if (la < la0) la0 = la; if (la > la1) la1 = la; if (lo < lo0) lo0 = lo; if (lo > lo1) lo1 = lo; }
    P.route.push(ri);
    P.headsign.push(p.headsign || sName[p.stops[p.stops.length - 1]]);
    P.stopOff.push(patternStops.length);
    P.nStops.push(p.stops.length);
    P.tripOff.push(trips.id.length);
    P.nTrips.push(p.trips.length);
    P.timeOff.push(times.length);
    P.shape.push(shp);
    P.bbox.push([+la0.toFixed(4), +lo0.toFixed(4), +la1.toFixed(4), +lo1.toFixed(4)]);
    patternStops.push(...p.stops);
    for (const t of p.trips) {
      trips.id.push(t.id);
      trips.service.push(svcIdx.get(t.service)!);
      for (const v of t.times) times.push(v);
    }
    for (const s of p.stops) {
      const k = stationOf[s];
      st.modes[k] |= MODE_BIT[routes.mode[ri]];
      if (!st.routes[k].includes(ri)) st.routes[k].push(ri);
    }
  }

  const grid = new Map<string, number[]>();
  const gk = (la: number, lo: number) => `${Math.floor(la / 0.004)}:${Math.floor(lo / 0.007)}`;
  for (let i = 0; i < S; i++) {
    const k = gk(sLat[i], sLon[i]);
    let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
  }
  const tr = { off: [] as number[], to: [] as number[], sec: [] as number[] };
  for (let i = 0; i < S; i++) {
    tr.off.push(tr.to.length);
    const ga = Math.floor(sLat[i] / 0.004), go = Math.floor(sLon[i] / 0.007);
    const out: [number, number][] = [];
    for (let a = -1; a <= 1; a++) for (let o = -1; o <= 1; o++) {
      for (const j of grid.get(`${ga + a}:${go + o}`) || []) {
        if (j === i) continue;
        const d = haversine(sLat[i], sLon[i], sLat[j], sLon[j]);
        const same = stationOf[i] === stationOf[j];
        if (d > WALK_RADIUS_M && !same) continue;
        out.push([j, Math.max(same ? SAME_STATION_SEC : 60, Math.round((d * 1.25) / WALK_SPEED) + 60)]);
      }
    }
    out.sort((a, b) => a[1] - b[1]);
    for (const [j, s] of out.slice(0, 40)) { tr.to.push(j); tr.sec.push(s); }
  }
  tr.off.push(tr.to.length);

  for (const k of st.routes.keys()) {
    st.routes[k].sort((a, b) => MODE_ORDER[routes.mode[a]] - MODE_ORDER[routes.mode[b]] || routes.short[a].localeCompare(routes.short[b], "da", { numeric: true }));
  }

  const tt: TimetableJson = {
    version: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    source,
    feedStart,
    days,
    stops: { id: sId, name: sName, lat: sLat, lon: sLon, station: stationOf, platform: sPlat },
    stations: st,
    routes,
    serviceBytes,
    services: svcBuf.toString("base64"),
    patterns: P,
    patternStops,
    trips,
    transfers: tr,
    shapes,
  };

  fs.writeFileSync(path.join(DATA, "times.bin"), Buffer.from(Int32Array.from(times).buffer));
  fs.writeFileSync(path.join(DATA, "shapes.bin"), Buffer.from(Float32Array.from(shapeCoords).buffer));
  fs.writeFileSync(path.join(DATA, "dists.bin"), Buffer.from(Float32Array.from(dists).buffer));
  fs.writeFileSync(outFile, JSON.stringify(tt));

  const network: NetworkJson = {
    feedStart,
    days,
    generatedAt: tt.generatedAt,
    routes: routes.id.map((_, i) => ({ s: routes.short[i], m: routes.mode[i], c: routes.color[i], t: routes.text[i] })),
    stations: st.id.map((_, k) => ({ i: k, n: st.name[k], la: st.lat[k], lo: st.lon[k], m: st.modes[k], r: st.routes[k].slice(0, 12) })),
  };
  fs.writeFileSync(path.join(PUB, "network.json"), JSON.stringify(network));

  const features: any[] = [];
  const doneShape = new Set<string>();
  P.route.forEach((ri, pi) => {
    const m = routes.mode[ri];
    if (m === "bus") return;
    const dk = ri + ":" + P.shape[pi];
    if (doneShape.has(dk)) return;
    doneShape.add(dk);
    const sh = P.shape[pi];
    const pts: [number, number][] = [];
    for (let j = 0; j < shapes.n[sh]; j++) pts.push([shapeCoords[(shapes.off[sh] + j) * 2 + 1], shapeCoords[(shapes.off[sh] + j) * 2]]);
    features.push({ type: "Feature", properties: { c: routes.color[ri], m, s: routes.short[ri] }, geometry: { type: "LineString", coordinates: simplify(pts, 0.00008).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) } });
  });
  fs.writeFileSync(path.join(PUB, "lines.geojson"), JSON.stringify({ type: "FeatureCollection", features }));

  const mb = (f: string) => (fs.statSync(path.join(f)).size / 1e6).toFixed(1) + " MB";
  console.log(`Wrote timetable ${mb(outFile)}, times ${mb(path.join(DATA, "times.bin"))}, shapes ${mb(path.join(DATA, "shapes.bin"))}, network ${mb(path.join(PUB, "network.json"))}, lines ${mb(path.join(PUB, "lines.geojson"))}`);
  console.log(`stations ${st.id.length}, routes ${routes.id.length}, patterns ${P.route.length}, trips ${trips.id.length}`);
}

const MODE_ORDER: Record<Mode, number> = { stog: 0, metro: 1, letbane: 2, tog: 3, bus: 4, faerge: 5 };

const RAIL_BITS = MODE_BIT.stog | MODE_BIT.metro | MODE_BIT.letbane | MODE_BIT.tog;
/** Same base name ("Lyngby St." / "Lyngby St. (Letbane)"). */
const HUB_RADIUS_M = 400;
/** Base names that only match once "St." is ignored ("Kirkebjerg (Letbane)" / "Kirkebjerg St. (Park Allé)"):
 * street-named bus stops further along the road share those, so stay closer. */
const HUB_LOOSE_RADIUS_M = 200;
const HUB_ALIAS: Record<string, string> = { "cph lufthavn": "københavns lufthavn" };
const hubBase = (n: string) => n.replace(/(\s*\([^)]*\))+\s*$/, "").trim().toLowerCase();
const hubLoose = (base: string) => {
  const b = base.replace(/\s+(st\.?|station)$/, "");
  return HUB_ALIAS[b] ?? b;
};
const KIND_SUFFIX = /\s*\((metro|letbane|s-tog|tog|togbus|bus)\)\s*$/i;

/**
 * Rejseplanen names the parts of one interchange differently ("Lyngby St.", "Lyngby St. (Letbane)",
 * "Lyngby St. (Jernbanepladsen)"), so the name-based grouping above keeps them apart. Merge every
 * station that shares a rail station's base name and lies near it. Bus-only look-alikes
 * ("Hovedgaden (A)" / "Hovedgaden (B)") are left alone.
 * Returns old key → hub key, and the display name of each hub.
 */
function mergeHubs(keys: string[], nameOf: (key: string) => string, lat: number[], lon: number[], modes: number[]) {
  type Agg = { key: string; name: string; base: string; la: number; lo: number; n: number; m: number };
  const agg = new Map<string, Agg>();
  keys.forEach((k, i) => {
    let a = agg.get(k);
    if (!a) { const name = nameOf(k); a = { key: k, name, base: hubBase(name), la: 0, lo: 0, n: 0, m: 0 }; agg.set(k, a); }
    a.la += lat[i]; a.lo += lon[i]; a.n++; a.m |= modes[i];
  });
  const byBase = new Map<string, Agg[]>();
  for (const a of agg.values()) {
    a.la /= a.n; a.lo /= a.n;
    const b = hubLoose(a.base);
    if (!b) continue;
    let l = byBase.get(b);
    if (!l) { l = []; byBase.set(b, l); }
    l.push(a);
  }
  const remap = new Map<string, string>();
  const names = new Map<string, string>();
  const near = (a: Agg, b: Agg) => haversine(a.la, a.lo, b.la, b.lo) < (a.base === b.base ? HUB_RADIUS_M : HUB_LOOSE_RADIUS_M);
  for (const list of byBase.values()) {
    if (list.length < 2) continue;
    const rails = list.filter((a) => a.m & RAIL_BITS);
    if (!rails.length) continue;
    const parent = rails.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < rails.length; i++) for (let j = i + 1; j < rails.length; j++) if (near(rails[i], rails[j])) parent[find(j)] = find(i);
    const members = new Map<number, Agg[]>();
    rails.forEach((a, i) => { const r = find(i); members.set(r, [...(members.get(r) || []), a]); });
    for (const a of list) {
      if (a.m & RAIL_BITS) continue;
      let best = -1, bd = Infinity;
      rails.forEach((r, i) => {
        const d = haversine(a.la, a.lo, r.la, r.lo);
        if (near(a, r) && d < bd) { bd = d; best = i; }
      });
      if (best >= 0) members.get(find(best))!.push(a);
    }
    for (const group of members.values()) {
      if (group.length < 2) continue;
      // Name the hub after its plainest rail station: "Lyngby St." over "Lyngby St. (Letbane)".
      const plain = (a: Agg) => +(a.name.replace(KIND_SUFFIX, "").trim().toLowerCase() !== a.base);
      const hub = group.filter((a) => a.m & RAIL_BITS).sort((a, b) => plain(a) - plain(b) || +/\(/.test(a.name) - +/\(/.test(b.name) || b.n - a.n)[0];
      names.set(hub.key, hub.name.replace(KIND_SUFFIX, "").trim());
      for (const a of group) if (a !== hub) remap.set(a.key, hub.key);
      if (process.env.HUB_DEBUG) console.log(`  hub ${names.get(hub.key)} <= ${group.filter((a) => a !== hub).map((a) => `${a.name} ${Math.round(haversine(a.la, a.lo, hub.la, hub.lo))}m`).join("; ")}`);
    }
  }
  return { remap, names };
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
      const [x, y] = pts[i];
      const u = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0;
      const ex = x - (x1 + u * dx), ey = y - (y1 + u * dy);
      const d = ex * ex + ey * ey;
      if (d > md) { md = d; mi = i; }
    }
    if (mi > 0 && md > tol * tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
