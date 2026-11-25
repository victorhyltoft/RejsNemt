"use client";
import type { NetworkJson } from "./format";
import type { Departure, Itinerary, PatternGeo, Realtime, RouteRef, TransitLeg, VehicleTrip } from "./types";

export type Station = NetworkJson["stations"][number];

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 401) {
    location.href = "/login";
    throw new Error("locked");
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

export type Place = number | { ll: [number, number]; name: string };
const placeQ = (k: string, p: Place) =>
  typeof p === "number" ? `${k}=${p}` : `${k}Lat=${p.ll[0].toFixed(6)}&${k}Lon=${p.ll[1].toFixed(6)}&${k}Name=${encodeURIComponent(p.name)}`;

const MB = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
export async function placeName(ll: [number, number]): Promise<string | null> {
  if (!MB) return null;
  try {
    const r = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${ll[1]}&latitude=${ll[0]}&types=address,street,poi&language=da&limit=1&access_token=${MB}`);
    const j = await r.json();
    const f = j.features?.[0]?.properties;
    return f ? f.name || f.full_address || null : null;
  } catch {
    return null;
  }
}

let netPromise: Promise<NetworkJson> | null = null;
export const loadNetwork = (): Promise<NetworkJson> => (netPromise ??= fetch("/data/network.json").then((r) => { if (!r.ok) { netPromise = null; throw new Error("network.json missing"); } return r.json() as Promise<NetworkJson>; }));

export const api = {
  plan: (from: Place, to: Place, time: string | null, arriveBy: boolean) =>
    get<{ itineraries: Itinerary[] }>(`/api/plan?${placeQ("from", from)}&${placeQ("to", to)}${time ? `&time=${time}` : ""}${arriveBy ? "&arriveBy=1" : ""}`),
  line: (q: { pattern?: number; route?: number }) =>
    get<{ route: RouteRef; routeIndex: number; patterns: { pattern: number; headsign: string; from: string; trips: number; geo: PatternGeo }[]; vehicles: VehicleTrip[]; now: number }>(
      `/api/line?${q.pattern !== undefined ? `pattern=${q.pattern}` : `route=${q.route}`}`,
    ),
  lineVehicles: (route: number) => get<{ vehicles: VehicleTrip[] }>(`/api/line?route=${route}&v=1`),
  alternatives: (from: number, to: number, after: number) =>
    get<{ options: { leg: TransitLeg; rt: Realtime | null }[] }>(`/api/alternatives?from=${from}&to=${to}&after=${Math.round(after)}`),
  departures: (station: number, limit?: number) => get<{ departures: Departure[]; now: number }>(`/api/departures?station=${station}${limit ? `&limit=${limit}` : ""}`),
  vehicles: (bbox: number[]) => get<{ vehicles: VehicleTrip[]; tooLarge?: boolean; now: number }>(`/api/vehicles?bbox=${bbox.map((x) => x.toFixed(4)).join(",")}`),
  trip: (id: string, date: string) => get<{ trip: VehicleTrip }>(`/api/trip?id=${encodeURIComponent(id)}&date=${date}`),
  rt: (keys: string[]) => get<{ rt: Record<string, Realtime | null> }>(`/api/rt?trips=${keys.map(encodeURIComponent).join(",")}`),
};

const geoCache = new Map<number, PatternGeo>();
const geoWait = new Map<number, Promise<void>>();
export async function patternGeos(ids: number[]): Promise<Map<number, PatternGeo>> {
  const missing = [...new Set(ids)].filter((i) => !geoCache.has(i) && !geoWait.has(i));
  for (let k = 0; k < missing.length; k += 60) {
    const chunk = missing.slice(k, k + 60);
    const pr = get<{ patterns: PatternGeo[] }>(`/api/pattern?ids=${chunk.join(",")}`).then((r) => {
      r.patterns.forEach((g) => geoCache.set(g.pattern, g));
    });
    chunk.forEach((i) => geoWait.set(i, pr));
  }
  await Promise.all(ids.map((i) => geoWait.get(i)).filter(Boolean));
  ids.forEach((i) => geoWait.delete(i));
  return geoCache;
}
export const geoOf = (p: number) => geoCache.get(p);

export const fmt = (ms: number) => new Date(ms).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }).replace(".", ":");
export const dur = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} t${min % 60 ? ` ${min % 60} min` : ""}`);
export const mins = (a: number, b: number) => Math.round((b - a) / 60000);
export const rtKey = (id: string, date: string) => `${id}|${date}`;

export function until(ms: number, now = Date.now()) {
  const m = Math.round((ms - now) / 60000);
  if (m < -1 || m > 120) return "";
  return m <= 0 ? "Afgår nu" : `om ${m} min`;
}

export function ld<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem("afsted_" + k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
export function sv(k: string, v: unknown) {
  try {
    localStorage.setItem("afsted_" + k, JSON.stringify(v));
  } catch {}
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function searchStations(list: Station[], q: string, limit = 30): Station[] {
  const nq = norm(q);
  if (!nq) return [];
  const scored: { s: Station; v: number }[] = [];
  for (const s of list) {
    const n = norm(s.n);
    const i = n.indexOf(nq);
    if (i < 0) continue;
    const rail = s.m & 15 ? 0 : 1;
    scored.push({ s, v: (i === 0 ? 0 : n.includes(" " + nq) ? 10 : 20) + rail * 5 + n.length / 100 });
  }
  return scored.sort((a, b) => a.v - b.v).slice(0, limit).map((x) => x.s);
}

export function distKm(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dA = (b[0] - a[0]) * r, dO = (b[1] - a[1]) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dO / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function nearby(list: Station[], at: [number, number], n = 6) {
  return list
    .map((s) => ({ s, km: distKm(at, [s.la, s.lo]) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

export const distTxt = (km: number) => (km < 1 ? `${Math.round((km * 1000) / 10) * 10} m` : `${km.toFixed(1).replace(".", ",")} km`);
export const walkTxt = (km: number) => {
  const m = Math.max(1, Math.round((km * 1000) / 80));
  return m > 60 ? "" : `${m} min gang`;
};

export function localParam(time: number | null, day: number) {
  if (time == null) return null;
  const d = new Date();
  d.setDate(d.getDate() + day);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(Math.floor(time / 60))}:${p(time % 60)}`;
}

export function rtStatus(rt?: Realtime | null) {
  if (!rt) return { label: "Planlagt", cls: "muted" };
  if (rt.cancelled) return { label: "Aflyst", cls: "late" };
  if (!rt.live) return { label: "Ingen live-data", cls: "muted" };
  const m = Math.round(rt.delay / 60);
  if (m >= 1) return { label: `Forsinket ${m} min`, cls: "late" };
  if (m <= -1) return { label: `${-m} min før tid`, cls: "soon" };
  return { label: "Til tiden", cls: "soon" };
}

export function localFromMs(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Re-find a station saved in localStorage. Indices change when the timetable is rebuilt, and a stop that
 * has since been merged into a hub ("Lyngby St. (Letbane)") is found under the hub's name ("Lyngby St."). */
export function findStation(list: Station[], r: { i: number; n: string } | null): Station | null {
  if (!r) return null;
  if (list[r.i]?.n === r.n) return list[r.i];
  const exact = list.find((x) => x.n === r.n);
  if (exact) return exact;
  const base = r.n.replace(/(\s*\([^)]*\))+\s*$/, "").trim();
  return base && base !== r.n ? list.find((x) => x.n === base) ?? null : null;
}

/** Whether we may ask for the position without a tap. iOS home-screen apps report "prompt" on every
 * launch even after the user said yes, so fall back to remembering that they allowed it before. */
export async function geoAllowed(): Promise<boolean> {
  try {
    const s = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (s?.state === "granted") return true;
    if (s?.state === "denied") return false;
  } catch {}
  return ld<boolean>("geo", false);
}

export function locate(): Promise<[number, number]> {
  return new Promise((ok, fail) => {
    if (!navigator.geolocation) return fail(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(
      (p) => { sv("geo", true); ok([p.coords.latitude, p.coords.longitude]); },
      (e) => { if (e.code === e.PERMISSION_DENIED) sv("geo", false); fail(e); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
