import type { Timetable } from "./timetable";
import type { Departure, Realtime } from "./types";
import { departures } from "./schedule";
import { toLocal } from "./time";

const KEY = process.env.REJSEPLANEN_API_KEY || "";
const BASE = (process.env.REJSEPLANEN_API_BASE || "https://www.rejseplanen.dk/api").replace(/\/$/, "");
const MOCK = process.env.MOCK_REALTIME === "1";
const DAILY_LIMIT = +(process.env.RT_DAILY_LIMIT || 1500);
const BOARD_TTL = 30_000;
const TRIP_TTL = 120_000;

export const realtimeMode: "api" | "mock" | "off" = KEY ? "api" : MOCK ? "mock" : "off";

const tripRt = new Map<string, Realtime>();
const boardAt = new Map<number, number>();
const apiStopId = new Map<number, string>();
const budget = { day: "", used: 0 };

const tk = (id: string, ymd: string) => `${id}|${ymd}`;

export function cachedRt(id: string, ymd: string): Realtime | undefined {
  const r = tripRt.get(tk(id, ymd));
  if (r && Date.now() - r.at < TRIP_TTL * 5) return r;
  if (realtimeMode === "mock") return mockRt(id, ymd);
  return undefined;
}

export function usage() {
  return { mode: realtimeMode, callsToday: budget.used, dailyLimit: DAILY_LIMIT };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mockRt(id: string, ymd: string): Realtime {
  const h = hash(id + ymd);
  const late = h % 100 < 28;
  const live = (h >>> 12) % 10 < 7;
  return { delay: live && late ? 60 * (1 + ((h >>> 8) % 6)) : 0, live, cancelled: live && h % 400 === 7, at: Date.now() - ((h >>> 4) % 25) * 1000, source: "mock" };
}

async function api(path: string, params: Record<string, string>) {
  const today = toLocal(Date.now()).ymd;
  if (budget.day !== today) { budget.day = today; budget.used = 0; }
  if (budget.used >= DAILY_LIMIT) throw new Error("daily API budget used");
  budget.used++;
  const q = new URLSearchParams({ ...params, accessId: KEY, format: "json" });
  const res = await fetch(`${BASE}/${path}?${q}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Rejseplanen ${path} ${res.status}`);
  return res.json();
}

async function resolveStopId(tt: Timetable, station: number): Promise<string> {
  const hit = apiStopId.get(station);
  if (hit) return hit;
  const gtfsId = tt.j.stations.id[station];
  try {
    const r = await api("location.nearbystops", {
      originCoordLat: String(tt.j.stations.lat[station]),
      originCoordLong: String(tt.j.stations.lon[station]),
      r: "300",
      maxNo: "5",
    });
    const list: any[] = (r.stopLocationOrCoordLocation || r.LocationList?.StopLocation || []).map((x: any) => x.StopLocation || x).filter(Boolean);
    const name = tt.j.stations.name[station].toLowerCase();
    const best = list.find((x) => String(x.name || "").toLowerCase().startsWith(name.split(" ")[0])) || list[0];
    const id = String(best?.extId || best?.id || gtfsId);
    apiStopId.set(station, id);
    return id;
  } catch {
    apiStopId.set(station, gtfsId);
    return gtfsId;
  }
}

const norm = (s: string) => String(s || "").toLowerCase().replace(/^(bus|s-tog|metro|letbane|tog|re|ic|lyn)\s+/, "").replace(/\s+/g, "");

function lineNames(d: any): string[] {
  const p = d.ProductAtStop || (Array.isArray(d.Product) ? d.Product[0] : d.Product) || {};
  const last = String(d.name || "").split(" ").pop() || "";
  return [p.line, p.displayNumber, p.num, p.name, d.name, last].filter(Boolean).map(norm);
}

function parseHms(date: string, time: string) {
  if (!date || !time) return null;
  const [y, m, dd] = date.split("-");
  const [h, mi, s] = time.split(":").map(Number);
  return { ymd: `${y}${m}${dd}`, secs: h * 3600 + mi * 60 + (s || 0) };
}

export async function refreshStation(tt: Timetable, station: number, timeMs = Date.now()): Promise<void> {
  if (realtimeMode !== "api") return;
  const last = boardAt.get(station);
  if (last && Date.now() - last < BOARD_TTL) return;
  boardAt.set(station, Date.now());
  const sched = departures(tt, station, timeMs - 5 * 60e3, 75, 120);
  if (!sched.length) return;
  const id = await resolveStopId(tt, station);
  const lt = toLocal(timeMs - 5 * 60e3);
  const r = await api("departureBoard", {
    id,
    date: `${lt.ymd.slice(0, 4)}-${lt.ymd.slice(4, 6)}-${lt.ymd.slice(6, 8)}`,
    time: `${String(Math.floor(lt.secs / 3600)).padStart(2, "0")}:${String(Math.floor((lt.secs % 3600) / 60)).padStart(2, "0")}`,
    duration: "75",
    passlist: "0",
  });
  const list: any[] = r.Departure || r.DepartureBoard?.Departure || [];
  const now = Date.now();
  for (const d of list) {
    const sch = parseHms(d.date, d.time);
    if (!sch) continue;
    const rt = parseHms(d.rtDate || d.date, d.rtTime || "");
    const names = lineNames(d);
    const match = sched.find((g) => {
      const gl = toLocal(g.time);
      return gl.ymd === sch.ymd && Math.abs(gl.secs - sch.secs) <= 60 && names.includes(norm(g.route.short));
    });
    if (!match) continue;
    const cancelled = d.cancelled === true || d.cancelled === "true" || d.reachable === false;
    const prog = String(d.prognosisType || "").toUpperCase();
    const live = !!rt || ["PROGNOSED", "REPORTED", "CALCULATED", "CORRECTED"].includes(prog);
    const delay = rt ? (rt.ymd === sch.ymd ? rt.secs - sch.secs : rt.secs + 86400 - sch.secs) : 0;
    tripRt.set(tk(match.tripId, match.serviceDate), { delay, live, cancelled, track: d.rtTrack || d.track, at: now, source: "api" });
  }
}

export async function withRealtime(tt: Timetable, station: number, deps: Departure[]): Promise<Departure[]> {
  try {
    await refreshStation(tt, station);
  } catch (e) {
    console.warn("realtime", (e as Error).message);
  }
  return deps.map((d) => ({ ...d, rt: cachedRt(d.tripId, d.serviceDate) }));
}

export async function tripRealtime(tt: Timetable, id: string, ymd: string): Promise<Realtime | undefined> {
  const cached = tripRt.get(tk(id, ymd));
  if (cached && Date.now() - cached.at < TRIP_TTL) return cached;
  if (realtimeMode !== "api") return cachedRt(id, ymd);
  const g = tt.tripIndex(id);
  if (g === undefined) return undefined;
  const { p, t } = tt.tripPattern(g);
  const now = toLocal(Date.now());
  const shift = (tt.dayShifts(now.ymd).find((s) => s.ymd === ymd)?.shift ?? 0);
  const local = now.secs - shift;
  const n = tt.j.patterns.nStops[p];
  let i = 0;
  while (i < n - 1 && tt.dep(p, t, i) < local - 60) i++;
  const station = tt.j.stops.station[tt.stopOf(p, i)];
  try {
    await refreshStation(tt, station);
  } catch (e) {
    console.warn("realtime", (e as Error).message);
  }
  return tripRt.get(tk(id, ymd)) || cached;
}
