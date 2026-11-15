import fs from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

const GEO: Record<string, [number, number]> = {
  Hillerød: [55.927, 12.311], Holte: [55.808, 12.469], Virum: [55.796, 12.473], Sorgenfri: [55.781, 12.481], Lyngby: [55.768, 12.503],
  Jægersborg: [55.758, 12.528], Gentofte: [55.751, 12.545], Hellerup: [55.731, 12.567], Svanemøllen: [55.715, 12.578], Nordhavn: [55.705, 12.59],
  Østerport: [55.693, 12.587], Nørreport: [55.683, 12.571], Vesterport: [55.676, 12.563], "København H": [55.672, 12.565], Dybbølsbro: [55.666, 12.56],
  Valby: [55.665, 12.515], Glostrup: [55.664, 12.398], "Høje Taastrup": [55.649, 12.27], "Ny Ellebjerg": [55.653, 12.517], Køge: [55.456, 12.186],
  Vanløse: [55.687, 12.491], Flintholm: [55.686, 12.499], Frederiksberg: [55.681, 12.532], Forum: [55.682, 12.553], "Kongens Nytorv": [55.679, 12.585],
  Christianshavn: [55.672, 12.591], Amagerbro: [55.663, 12.603], Øresund: [55.661, 12.629], Kastrup: [55.636, 12.647], Lufthavnen: [55.63, 12.65],
  "Islands Brygge": [55.663, 12.585], "DR Byen": [55.656, 12.589], Ørestad: [55.629, 12.579], Vestamager: [55.619, 12.576],
  Rådhuspladsen: [55.676, 12.569], "Gammel Strand": [55.678, 12.578], Marmorkirken: [55.685, 12.589], Trianglen: [55.699, 12.576],
  "Poul Henningsens Plads": [55.709, 12.574], Nørrebro: [55.7, 12.538], Ryparken: [55.716, 12.556], DTU: [55.786, 12.524],
  "Gladsaxe Trafikplads": [55.739, 12.489], Herlev: [55.719, 12.443], Ishøj: [55.613, 12.358], Roskilde: [55.639, 12.089], Odense: [55.401, 10.387], "Malmö C": [55.609, 13.0],
};

type L = { id: string; type: number; color?: string; head: number; stops: [string, number][]; jitter: number };
const LINES: L[] = [
  { id: "A", type: 109, head: 10, jitter: 0, stops: [["Hillerød", 0], ["Holte", 16], ["Virum", 19], ["Sorgenfri", 21], ["Lyngby", 24], ["Jægersborg", 27], ["Gentofte", 29], ["Hellerup", 33], ["Svanemøllen", 36], ["Nordhavn", 38], ["Østerport", 40], ["Nørreport", 43], ["Vesterport", 45], ["København H", 47], ["Dybbølsbro", 49], ["Ny Ellebjerg", 54], ["Køge", 85]] },
  { id: "B", type: 109, head: 10, jitter: 5, stops: [["Holte", 0], ["Virum", 3], ["Sorgenfri", 5], ["Lyngby", 8], ["Jægersborg", 11], ["Gentofte", 13], ["Hellerup", 17], ["Svanemøllen", 20], ["Nordhavn", 22], ["Østerport", 24], ["Nørreport", 27], ["Vesterport", 29], ["København H", 31], ["Valby", 36], ["Glostrup", 45], ["Høje Taastrup", 53]] },
  { id: "M1", type: 401, head: 4, jitter: 1, stops: [["Vanløse", 0], ["Flintholm", 2], ["Frederiksberg", 6], ["Forum", 7], ["Nørreport", 9], ["Kongens Nytorv", 10], ["Christianshavn", 12], ["Islands Brygge", 14], ["DR Byen", 15], ["Ørestad", 19], ["Vestamager", 21]] },
  { id: "M2", type: 401, head: 4, jitter: 3, stops: [["Vanløse", 0], ["Flintholm", 2], ["Frederiksberg", 6], ["Forum", 7], ["Nørreport", 9], ["Kongens Nytorv", 10], ["Christianshavn", 12], ["Amagerbro", 14], ["Øresund", 16], ["Kastrup", 19], ["Lufthavnen", 21]] },
  { id: "M3", type: 401, head: 4, jitter: 2, stops: [["København H", 0], ["Rådhuspladsen", 1], ["Gammel Strand", 3], ["Kongens Nytorv", 4], ["Marmorkirken", 5], ["Østerport", 7], ["Trianglen", 8], ["Poul Henningsens Plads", 9], ["Nørrebro", 13], ["Frederiksberg", 17]] },
  { id: "L", type: 900, head: 7, jitter: 4, stops: [["Lyngby", 0], ["DTU", 6], ["Gladsaxe Trafikplads", 14], ["Herlev", 22], ["Glostrup", 34], ["Ishøj", 46]] },
  { id: "150S", type: 700, head: 10, jitter: 6, stops: [["Nørreport", 0], ["Trianglen", 6], ["Ryparken", 12], ["Jægersborg", 20], ["DTU", 28]] },
  { id: "RE", type: 2, head: 20, jitter: 8, stops: [["Østerport", 0], ["Nørreport", 3], ["København H", 6], ["Valby", 10], ["Høje Taastrup", 17], ["Roskilde", 26]] },
  { id: "IC", type: 2, head: 30, jitter: 15, stops: [["København H", 0], ["Høje Taastrup", 14], ["Roskilde", 23], ["Odense", 78]] },
  { id: "Ø", type: 2, head: 20, jitter: 11, stops: [["Østerport", 0], ["Nørreport", 3], ["København H", 6], ["Ørestad", 12], ["Lufthavnen", 17], ["Malmö C", 38]] },
];

const modeKey = (t: number) => (t === 401 ? "metro" : t === 900 ? "letbane" : t === 700 ? "bus" : t === 2 ? "tog" : "stog");
const OFFSET: Record<string, [number, number]> = { metro: [0.0004, 0.0003], letbane: [-0.0003, 0.0004], bus: [0.0002, -0.0004], tog: [-0.0002, -0.0002], stog: [0, 0] };

const stops = new Map<string, { id: string; name: string; lat: number; lon: number }>();
const stopFor = (name: string, mode: string) => {
  const k = `${name}|${mode}`;
  if (!stops.has(k)) {
    const [la, lo] = GEO[name];
    const [da, dd] = OFFSET[mode];
    stops.set(k, { id: String(8600000 + stops.size), name, lat: la + da, lon: lo + dd });
  }
  return stops.get(k)!;
};

const fmt = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((v) => (typeof v === "string" && /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";

const routes: (string | number)[][] = [["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"]];
const trips: (string | number)[][] = [["route_id", "service_id", "trip_id", "trip_headsign", "shape_id"]];
const st: (string | number)[][] = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]];
const shapes: (string | number)[][] = [["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]];

for (const l of LINES) {
  routes.push([l.id, "1", l.id, "", l.type]);
  const m = modeKey(l.type);
  for (const dir of [0, 1]) {
    const seq = dir ? [...l.stops].reverse().map(([n, t]) => [n, l.stops[l.stops.length - 1][1] - t] as [string, number]) : l.stops;
    const shapeId = `${l.id}_${dir}`;
    let n = 0;
    for (let i = 0; i < seq.length; i++) {
      const a = stopFor(seq[i][0], m);
      shapes.push([shapeId, a.lat.toFixed(6), a.lon.toFixed(6), n++]);
      if (i < seq.length - 1) {
        const b = stopFor(seq[i + 1][0], m);
        const ml = (a.lat + b.lat) / 2 + (b.lon - a.lon) * 0.06, mo = (a.lon + b.lon) / 2 - (b.lat - a.lat) * 0.06;
        shapes.push([shapeId, ml.toFixed(6), mo.toFixed(6), n++]);
      }
    }
    const start = 5 * 3600 + (l.jitter + (dir ? Math.floor(l.head / 2) : 0)) * 60;
    for (let t0 = start, k = 0; t0 < 25 * 3600; t0 += l.head * 60, k++) {
      const tripId = `${l.id}_${dir}_${k}`;
      trips.push([l.id, "ALL", tripId, seq[seq.length - 1][0], shapeId]);
      seq.forEach(([name, min], i) => {
        const s = stopFor(name, m);
        const arr = t0 + min * 60;
        const dwell = i === 0 || i === seq.length - 1 ? 0 : 30;
        st.push([tripId, fmt(arr), fmt(arr + dwell), s.id, i + 1]);
      });
    }
  }
}

const today = new Date();
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const end = new Date(today.getTime() + 120 * 864e5);
const files = {
  "agency.txt": csv([["agency_id", "agency_name", "agency_url", "agency_timezone"], ["1", "Sample", "https://example.com", "Europe/Copenhagen"]]),
  "stops.txt": csv([["stop_id", "stop_name", "stop_lat", "stop_lon"], ...[...stops.values()].map((s) => [s.id, s.name, s.lat.toFixed(6), s.lon.toFixed(6)])]),
  "routes.txt": csv(routes),
  "trips.txt": csv(trips),
  "stop_times.txt": csv(st),
  "shapes.txt": csv(shapes),
  "calendar.txt": csv([["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], ["ALL", 1, 1, 1, 1, 1, 1, 1, ymd(new Date(today.getTime() - 3 * 864e5)), ymd(end)]]),
};
const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
fs.mkdirSync("fixtures", { recursive: true });
fs.writeFileSync(path.join("fixtures", "sample-gtfs.zip"), zip);
console.log(`sample GTFS: ${stops.size} stops, ${trips.length - 1} trips, ${st.length - 1} stop_times`);
