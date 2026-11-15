"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { NetworkJson } from "@/lib/format";
import type { PatternGeo, RouteRef, VehicleTrip } from "@/lib/types";
import { MODE_LABEL } from "@/lib/modes";
import { api, fmt, rtStatus } from "@/lib/client";
import { positionAt } from "@/lib/vehicle-position";
import { Icon, modeIcon } from "./Icons";
import { LineBadge } from "./LineBadge";
import { RtIcon } from "./RtIcon";

const LiveMap = dynamic(() => import("./LiveMap"), { ssr: false, loading: () => <div className="map skeleton" /> });

export interface LineQuery {
  pattern?: number;
  route?: number;
  tripId?: string;
  date?: string;
}

type LineData = Awaited<ReturnType<typeof api.line>>;

export default function LineSheet({ net, theme, q, onClose }: { net: NetworkJson; theme: "light" | "dark"; q: LineQuery; onClose: () => void }) {
  const [data, setData] = useState<LineData | null>(null);
  const [err, setErr] = useState(false);
  const [sel, setSel] = useState(0);
  const [trip, setTrip] = useState<VehicleTrip | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    api.line({ pattern: q.pattern, route: q.route }).then(setData).catch(() => setErr(true));
    if (q.tripId && q.date) api.trip(q.tripId, q.date).then((r) => setTrip(r.trip)).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, [q.pattern, q.route, q.tripId, q.date]);

  const pat = data?.patterns[sel];
  const geo: PatternGeo | undefined = pat?.geo;
  const line = useMemo(() => (geo && data ? { coords: geo.coords, color: data.route.color, stops: geo.stops } : null), [geo, data]);
  const showTrip = trip && pat && trip.pattern === pat.pattern ? trip : null;
  const pos = showTrip && geo ? positionAt(showTrip, geo, now) : null;
  const delay = showTrip?.rt?.delay ?? 0;
  const route: RouteRef | null = data?.route ?? null;
  const live = data ? data.vehicles.filter((v) => !pat || v.pattern === pat.pattern).length : 0;

  return (
    <>
      <div className="shbg" onClick={onClose} />
      <div className="sheet full line-sheet">
        <div className="grab" />
        <div className="lsh">
          {route && <LineBadge r={route} />}
          <div className="t">
            <b>{route ? `${MODE_LABEL[route.mode]} ${route.short}` : "Linje"}</b>
            <span>{pat ? `${pat.from} → ${pat.headsign}` : err ? "Kunne ikke hente linjen" : "Henter…"}</span>
          </div>
          <button className="icon-btn flat" onClick={onClose} aria-label="Luk"><Icon name="x" /></button>
        </div>
        {data && data.patterns.length > 1 && (
          <div className="chips" style={{ padding: "0 16px 10px" }}>
            {data.patterns.map((p, i) => (
              <button key={p.pattern} className={"chip" + (i === sel ? " on" : "")} onClick={() => setSel(i)}>
                <Icon name="right" className="ci" />mod {p.headsign}
              </button>
            ))}
          </div>
        )}
        <div className="lsbody">
          {data && route && (
            <LiveMap
              network={net}
              theme={theme}
              height="38vh"
              mode="line"
              line={line}
              fetchVehicles={() => api.lineVehicles(data.routeIndex).then((r) => r.vehicles)}
            />
          )}
          {!data && !err && <div className="map skeleton" />}
          {data && (
            <div className="sub-info ii">
              <span className="pulse" />{live ? `${live} ${live === 1 ? "afgang" : "afgange"} kører på strækningen lige nu` : "Ingen afgange kører lige nu"}
              {showTrip && <span className={"tag " + (delay >= 60 ? "warn" : "")} style={{ marginLeft: "auto" }}><RtIcon rt={showTrip.rt} sm />{rtStatus(showTrip.rt).label}</span>}
            </div>
          )}
          {geo && (
            <div className="card tl line-stops">
              {geo.stops.map((s, i) => {
                const passed = pos ? i < pos.next : false;
                const here = pos && i === pos.next;
                const time = showTrip ? showTrip.base + ((i === 0 ? showTrip.times[1] : showTrip.times[2 * i]) + delay) * 1000 : null;
                const first = i === 0, last = i === geo.stops.length - 1;
                return (
                  <div key={i} className={"lstop" + (passed ? " passed" : "")}>
                    <div className="tm">{time ? fmt(time) : ""}</div>
                    <div className="nd">
                      {!first && <span className="rail" style={{ background: route!.color, top: 0, height: "50%" }} />}
                      {!last && <span className="rail" style={{ background: route!.color, top: "50%", bottom: 0 }} />}
                      <span className="node" style={{ borderColor: route!.color, background: first || last ? route!.color : undefined }} />
                      {here && <span className="veh-dot" style={{ background: route!.color }}><Icon name={modeIcon(route!.mode)} /></span>}
                    </div>
                    <div className="nm">
                      <b>{s.name}</b>
                      {here && <span className="soon">{pos!.state === "stopped" ? "Holder her nu" : "Næste stop"}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
