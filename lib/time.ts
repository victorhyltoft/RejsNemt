const TZ = "Europe/Copenhagen";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface LocalTime {
  ymd: string;
  secs: number;
}

export function toLocal(ms: number): LocalTime {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}${p.month}${p.day}`, secs: +p.hour * 3600 + +p.minute * 60 + +p.second };
}

function offsetMs(ms: number) {
  const l = toLocal(ms);
  const asUtc = Date.UTC(+l.ymd.slice(0, 4), +l.ymd.slice(4, 6) - 1, +l.ymd.slice(6, 8)) + l.secs * 1000;
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export function localToMs(ymd: string, secs: number): number {
  const guess = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) + secs * 1000;
  let ms = guess - offsetMs(guess);
  ms = guess - offsetMs(ms);
  return ms;
}

export function serviceDayStartMs(ymd: string): number {
  return localToMs(ymd, 12 * 3600) - 12 * 3600 * 1000;
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) + n * 864e5);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function dayDiff(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8));
  return Math.round((db - da) / 864e5);
}

export function parseLocalParam(v: string | null): number | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return localToMs(`${m[1]}${m[2]}${m[3]}`, +m[4] * 3600 + +m[5] * 60);
}
