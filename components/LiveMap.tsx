"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as MbMap, GeoJSONSource, Popup } from "mapbox-gl";
import type { NetworkJson } from "@/lib/format";
import type { Itinerary, Realtime, VehicleTrip } from "@/lib/types";
import { api, fmt, geoAllowed, geoOf, patternGeos, rtKey, rtStatus, sv } from "@/lib/client";
import { positionAt } from "@/lib/vehicle-position";
import { MODE_LABEL } from "@/lib/modes";
import { rtIconHtml } from "./RtIcon";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const EMPTY = { type: "FeatureCollection" as const, features: [] as any[] };
const VEHICLE_MIN_ZOOM = 12.5;

export interface LiveMapProps {
  network: NetworkJson;
  theme: "light" | "dark";
  height: string;
  mode: "explore" | "journey" | "line";
  line?: { coords: [number, number][]; color: string; stops: { name: string; lat: number; lon: number }[] } | null;
  fetchVehicles?: () => Promise<VehicleTrip[]>;
  onLine?: (x: { pattern: number; tripId: string; date: string }) => void;
  pins?: { from?: [number, number] | null; to?: [number, number] | null; drop?: [number, number] | null };
  onPoint?: (ll: [number, number]) => void;
  itinerary?: Itinerary | null;
  rt?: Record<string, Realtime | null>;
  focus?: [number, number] | null;
  /** Where to open the map when there is no focus, e.g. the last known position. */
  start?: [number, number] | null;
  /** Find the user on open, if they have allowed location before. */
  autoLocate?: boolean;
  selectedStation?: number | null;
  onStation?: (i: number) => void;
  onLocate?: (ll: [number, number]) => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function popupHtml(v: VehicleTrip, now: number, link = true) {
  const g = geoOf(v.pattern);
  const pos = g ? positionAt(v, g, now) : null;
  const st = rtStatus(v.rt);
  const next = pos && g ? g.stops[pos.next] : null;
  const ago = v.rt ? Math.max(0, Math.round((now - v.rt.at) / 1000)) : null;
  const upd = v.rt
    ? v.rt.source === "mock"
      ? "Demo-forsinkelse"
      : ago! < 10
        ? "Opdateret lige nu"
        : ago! < 90
          ? `Opdateret for ${ago} sek. siden`
          : `Opdateret for ${Math.round(ago! / 60)} min. siden`
    : "Position ud fra køreplanen";
  return `<div class="vp">
    <div class="vp-h"><span class="lb ${v.route.mode}" style="background:${v.route.color};color:${v.route.text}">${esc(v.route.short)}</span><b>${esc(v.headsign)}</b></div>
    <div class="vp-s">${rtIconHtml(v.rt)}<span class="${st.cls}">${st.label}</span>${next && pos ? ` · ${pos.state === "stopped" ? "ved" : "næste"} ${esc(next.name)} ${fmt(pos.nextTime)}` : ""}</div>
    <div class="vp-u">${v.rt && v.rt.source === "api" ? '<span class="pulse"></span>' : ""}${MODE_LABEL[v.route.mode]} · ${upd}</div>
    ${link ? `<button class="vp-link" data-line="${v.pattern}" data-trip="${esc(v.tripId)}" data-date="${v.serviceDate}">Se hele linjen ›</button>` : ""}
  </div>`;
}

export default function LiveMap(p: LiveMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MbMap | null>(null);
  const vehicles = useRef(new Map<string, VehicleTrip>());
  const selected = useRef<string | null>(null);
  const popup = useRef<Popup | null>(null);
  const props = useRef(p);
  props.current = p;
  const [err, setErr] = useState<string | null>(TOKEN ? null : "Kortet mangler en Mapbox-nøgle (NEXT_PUBLIC_MAPBOX_TOKEN).");
  const [zoomHint, setZoomHint] = useState(false);

  useEffect(() => {
    if (!TOKEN || !el.current) return;
    let disposed = false;
    let tick: ReturnType<typeof setInterval> | undefined;
    let refresh: ReturnType<typeof setInterval> | undefined;
    let deb: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (disposed || !el.current) return;
      mapboxgl.accessToken = TOKEN;
      const net = props.current.network;
      const at = props.current.focus || props.current.start;
      const map = new mapboxgl.Map({
        container: el.current,
        style: props.current.theme === "dark" ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11",
        center: at ? [at[1], at[0]] : [12.5683, 55.6761],
        zoom: at ? 14 : 11.5,
        attributionControl: true,
        pitchWithRotate: false,
      });
      mapRef.current = map;
      map.on("error", (e: any) => {
        if (String(e?.error?.message || "").match(/token|401|403/i)) setErr("Mapbox afviste nøglen. Tjek NEXT_PUBLIC_MAPBOX_TOKEN og URL-begrænsningerne.");
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      const geo = new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true });
      map.addControl(geo, "top-right");
      geo.on("geolocate", (e: any) => {
        sv("geo", true);
        props.current.onLocate?.([e.coords.latitude, e.coords.longitude]);
      });
      geo.on("error", (e: any) => {
        if (e?.code === 1) sv("geo", false);
      });

      const stationsFc = {
        type: "FeatureCollection" as const,
        features: net.stations.map((s) => ({ type: "Feature" as const, properties: { i: s.i, n: s.n, rail: s.m & 15 ? 1 : 0 }, geometry: { type: "Point" as const, coordinates: [s.lo, s.la] } })),
      };

      const addLayers = () => {
        const dark = props.current.theme === "dark";
        const halo = dark ? "#151821" : "#ffffff";
        const ink = dark ? "#F2F4F7" : "#0E1116";
        if (props.current.mode === "explore") {
          map.addSource("lines", { type: "geojson", data: "/data/lines.geojson" });
          map.addLayer({ id: "lines", type: "line", source: "lines", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "c"], "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 4], "line-opacity": 0.75 } });
        }
        map.addSource("sel", { type: "geojson", data: EMPTY });
        map.addLayer({ id: "sel-case", type: "line", source: "sel", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": halo, "line-width": 9 } });
        map.addLayer({ id: "sel", type: "line", source: "sel", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "c"], "line-width": 5 } });
        map.addSource("legs", { type: "geojson", data: EMPTY });
        map.addLayer({ id: "legs-case", type: "line", source: "legs", filter: ["==", ["get", "w"], 0], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": halo, "line-width": 10 } });
        map.addLayer({ id: "legs", type: "line", source: "legs", filter: ["==", ["get", "w"], 0], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "c"], "line-width": 6 } });
        map.addLayer({ id: "legs-walk", type: "line", source: "legs", filter: ["==", ["get", "w"], 1], layout: { "line-cap": "round" }, paint: { "line-color": "#8A94A6", "line-width": 3, "line-dasharray": [0.5, 2] } });
        map.addSource("stations", { type: "geojson", data: stationsFc });
        map.addLayer({
          id: "stations",
          type: "circle",
          source: "stations",
          filter: props.current.mode === "explore" ? ["any", ["==", ["get", "rail"], 1], [">=", ["zoom"], 14]] : ["==", ["get", "i"], -1],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["case", ["==", ["get", "rail"], 1], 2.5, 1.5], 15, ["case", ["==", ["get", "rail"], 1], 6, 4]],
            "circle-color": halo,
            "circle-stroke-color": ink,
            "circle-stroke-width": ["case", ["==", ["get", "rail"], 1], 2, 1.5],
          },
        });
        map.addLayer({
          id: "station-labels",
          type: "symbol",
          source: "stations",
          filter: props.current.mode === "explore" ? ["any", ["all", ["==", ["get", "rail"], 1], [">=", ["zoom"], 12]], [">=", ["zoom"], 15.5]] : ["==", ["get", "i"], -1],
          layout: { "text-field": ["get", "n"], "text-size": 12, "text-offset": [0.8, 0], "text-anchor": "left", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"], "text-optional": true },
          paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.5 },
        });
        map.addSource("ends", { type: "geojson", data: EMPTY });
        map.addLayer({ id: "ends", type: "circle", source: "ends", paint: { "circle-radius": 7, "circle-color": ["case", ["==", ["get", "k"], "to"], ink, halo], "circle-stroke-color": ["case", ["==", ["get", "k"], "to"], halo, "#2F6BFF"], "circle-stroke-width": 3.5 } });
        map.addSource("pstops", { type: "geojson", data: EMPTY });
        map.addLayer({ id: "pstops", type: "circle", source: "pstops", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 15, 6], "circle-color": halo, "circle-stroke-color": ["get", "c"], "circle-stroke-width": 2.5 } });
        map.addLayer({ id: "pstops-label", type: "symbol", source: "pstops", minzoom: 10.5, layout: { "text-field": ["get", "n"], "text-size": 11.5, "text-offset": [0.9, 0], "text-anchor": "left", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"], "text-optional": true }, paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.5 } });
        map.addSource("veh", { type: "geojson", data: EMPTY });
        map.addLayer({ id: "veh-live", type: "circle", source: "veh", filter: ["==", ["get", "live"], 1], paint: { "circle-radius": ["case", ["==", ["get", "sel"], 1], 19, 16.5], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#0E9F6E", "circle-stroke-width": 2.5, "circle-stroke-opacity": 0.9 } });
        map.addLayer({ id: "veh-shadow", type: "circle", source: "veh", paint: { "circle-radius": 15, "circle-color": "#000", "circle-opacity": 0.12, "circle-blur": 0.6, "circle-translate": [0, 2] } });
        map.addLayer({ id: "veh", type: "circle", source: "veh", paint: { "circle-radius": ["case", ["==", ["get", "sel"], 1], 15, 12.5], "circle-color": ["get", "c"], "circle-stroke-color": ["case", ["==", ["get", "late"], 1], "#E5484D", halo], "circle-stroke-width": ["case", ["==", ["get", "late"], 1], 3, 2.5] } });
        map.addLayer({ id: "veh-label", type: "symbol", source: "veh", layout: { "text-field": ["get", "s"], "text-size": ["case", [">", ["length", ["get", "s"]], 3], 8.5, 11], "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-allow-overlap": true, "text-ignore-placement": true }, paint: { "text-color": ["get", "t"] } });
        map.addSource("pins", { type: "geojson", data: EMPTY });
        map.addLayer({ id: "pins-halo", type: "circle", source: "pins", filter: ["==", ["get", "k"], "drop"], paint: { "circle-radius": 22, "circle-color": "#2F6BFF", "circle-opacity": 0.18 } });
        map.addLayer({ id: "pins", type: "circle", source: "pins", paint: { "circle-radius": ["case", ["==", ["get", "k"], "drop"], 9, 8], "circle-color": ["match", ["get", "k"], "to", ink, "drop", "#2F6BFF", halo], "circle-stroke-color": ["match", ["get", "k"], "from", "#2F6BFF", halo], "circle-stroke-width": ["match", ["get", "k"], "from", 4, 3] } });
        drawPins();
        drawJourney();
        drawLine();
        drawSelected();
      };

      const drawPins = () => {
        const src = map.getSource("pins") as GeoJSONSource | undefined;
        if (!src) return;
        const pins = props.current.pins || {};
        const feats = (["from", "to", "drop"] as const).filter((k) => pins[k]).map((k) => ({ type: "Feature" as const, properties: { k }, geometry: { type: "Point" as const, coordinates: [pins[k]![1], pins[k]![0]] } }));
        src.setData({ type: "FeatureCollection", features: feats });
      };

      const drawLine = () => {
        const ln = props.current.line;
        if (props.current.mode !== "line") return;
        const legs = map.getSource("legs") as GeoJSONSource | undefined;
        const ps = map.getSource("pstops") as GeoJSONSource | undefined;
        if (!legs || !ps) return;
        if (!ln) { legs.setData(EMPTY); ps.setData(EMPTY); return; }
        legs.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { c: ln.color, w: 0 }, geometry: { type: "LineString", coordinates: ln.coords } }] });
        ps.setData({ type: "FeatureCollection", features: ln.stops.map((x) => ({ type: "Feature", properties: { n: x.name, c: ln.color }, geometry: { type: "Point", coordinates: [x.lon, x.lat] } })) });
      };

      const fitLine = () => {
        const ln = props.current.line;
        if (!ln || !ln.coords.length) return;
        const b = new mapboxgl.LngLatBounds();
        ln.coords.forEach((c) => b.extend(c));
        map.fitBounds(b, { padding: 36, duration: map.loaded() ? 500 : 0, maxZoom: 15 });
      };

      const loadLine = async () => {
        if (props.current.mode !== "line" || !props.current.fetchVehicles) return;
        try {
          const list = await props.current.fetchVehicles();
          await patternGeos(list.map((v) => v.pattern));
          const next = new Map<string, VehicleTrip>();
          for (const v of list) {
            const k = rtKey(v.tripId, v.serviceDate);
            const old = vehicles.current.get(k);
            next.set(k, old?.rt && (!v.rt || old.rt.at > v.rt.at) ? { ...v, rt: old.rt } : v);
          }
          vehicles.current = next;
          render();
        } catch {}
      };

      const drawJourney = () => {
        const it = props.current.itinerary;
        const legs = map.getSource("legs") as GeoJSONSource | undefined;
        const ends = map.getSource("ends") as GeoJSONSource | undefined;
        if (!legs || !ends) return;
        if (!it) { legs.setData(EMPTY); ends.setData(EMPTY); return; }
        legs.setData({
          type: "FeatureCollection",
          features: it.legs.map((l) => ({
            type: "Feature",
            properties: { c: l.type === "transit" ? l.route.color : "#888", w: l.type === "walk" ? 1 : 0 },
            geometry: { type: "LineString", coordinates: l.type === "transit" ? l.shape : [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]] },
          })),
        });
        const a = it.legs[0], b = it.legs[it.legs.length - 1];
        ends.setData({ type: "FeatureCollection", features: [
          { type: "Feature", properties: { k: "from" }, geometry: { type: "Point", coordinates: [a.from.lon, a.from.lat] } },
          { type: "Feature", properties: { k: "to" }, geometry: { type: "Point", coordinates: [b.to.lon, b.to.lat] } },
        ] });
      };

      const drawSelected = () => {
        const src = map.getSource("sel") as GeoJSONSource | undefined;
        if (!src) return;
        const v = selected.current ? vehicles.current.get(selected.current) : null;
        const g = v ? geoOf(v.pattern) : null;
        src.setData(v && g && props.current.mode === "explore" ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { c: v.route.color }, geometry: { type: "LineString", coordinates: g.coords } }] } : EMPTY);
      };

      const render = () => {
        const src = map.getSource("veh") as GeoJSONSource | undefined;
        if (!src) return;
        const now = Date.now();
        const feats: any[] = [];
        for (const [k, v] of vehicles.current) {
          const g = geoOf(v.pattern);
          if (!g) continue;
          const pos = positionAt(v, g, now);
          if (!pos) continue;
          feats.push({ type: "Feature", properties: { k, c: v.route.color, t: v.route.text, s: v.route.short, live: v.rt?.live ? 1 : 0, late: (v.rt?.delay ?? 0) >= 120 ? 1 : 0, sel: k === selected.current ? 1 : 0 }, geometry: { type: "Point", coordinates: [pos.lon, pos.lat] } });
          if (k === selected.current && popup.current) {
            popup.current.setLngLat([pos.lon, pos.lat]).setHTML(popupHtml(v, now, props.current.mode !== "line"));
          }
        }
        src.setData({ type: "FeatureCollection", features: feats });
      };

      const loadExplore = async () => {
        if (props.current.mode !== "explore") return;
        const z = map.getZoom();
        setZoomHint(z < VEHICLE_MIN_ZOOM);
        if (z < VEHICLE_MIN_ZOOM) {
          for (const k of [...vehicles.current.keys()]) if (k !== selected.current) vehicles.current.delete(k);
          render();
          return;
        }
        const b = map.getBounds()!;
        try {
          const r = await api.vehicles([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
          await patternGeos(r.vehicles.map((v) => v.pattern));
          const next = new Map<string, VehicleTrip>();
          for (const v of r.vehicles) {
            const k = rtKey(v.tripId, v.serviceDate);
            const old = vehicles.current.get(k);
            next.set(k, old?.rt && (!v.rt || old.rt.at > v.rt.at) ? { ...v, rt: old.rt } : v);
          }
          if (selected.current && !next.has(selected.current) && vehicles.current.has(selected.current)) next.set(selected.current, vehicles.current.get(selected.current)!);
          vehicles.current = next;
          render();
        } catch (e) {
          console.warn(e);
        }
      };

      const loadJourney = async () => {
        if (props.current.mode !== "journey" || !props.current.itinerary) return;
        const legs = props.current.itinerary.legs.filter((l) => l.type === "transit");
        const next = new Map<string, VehicleTrip>();
        await Promise.all(
          legs.map(async (l) => {
            if (l.type !== "transit") return;
            try {
              const { trip } = await api.trip(l.tripId, l.serviceDate);
              next.set(rtKey(l.tripId, l.serviceDate), trip);
            } catch {}
          }),
        );
        await patternGeos([...next.values()].map((v) => v.pattern));
        vehicles.current = next;
        render();
      };

      map.on("style.load", addLayers);
      map.on("moveend", () => {
        clearTimeout(deb);
        deb = setTimeout(loadExplore, 350);
      });
      map.on("click", (e: any) => {
        if (!props.current.onPoint) return;
        const hit = map.queryRenderedFeatures(e.point, { layers: ["veh", "stations"].filter((l) => map.getLayer(l)) });
        if (hit.length) return;
        props.current.onPoint([e.lngLat.lat, e.lngLat.lng]);
      });
      map.on("click", "stations", (e: any) => {
        const f = e.features?.[0];
        if (f) props.current.onStation?.(f.properties.i);
      });
      map.on("click", "veh", async (e: any) => {
        const k = e.features?.[0]?.properties?.k as string;
        const v = k && vehicles.current.get(k);
        if (!v) return;
        selected.current = k;
        // Popup.remove() fires "close" even on a popup that is already closed, so the previous popup's
        // handler must not clear the new selection (it did when the same vehicle was tapped again).
        const prev = popup.current;
        const pp = new mapboxgl.Popup({ closeButton: false, offset: 18, maxWidth: "280px", className: "vpop" }).setLngLat(e.lngLat).setHTML(popupHtml(v, Date.now(), props.current.mode !== "line"));
        popup.current = pp;
        prev?.remove();
        pp.on("close", () => {
          if (popup.current !== pp) return;
          popup.current = null;
          selected.current = null;
          drawSelected();
          render();
        });
        pp.addTo(map);
        drawSelected();
        render();
        try {
          const r = await api.rt([k]);
          const cur = vehicles.current.get(k);
          if (cur && r.rt[k]) cur.rt = r.rt[k]!;
          render();
        } catch {}
      });
      for (const id of ["veh", "stations"]) {
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("load", () => {
        if (props.current.mode === "line") {
          fitLine();
          loadLine();
        } else if (props.current.mode === "journey" && props.current.itinerary) {
          const b = new mapboxgl.LngLatBounds();
          for (const l of props.current.itinerary.legs) (l.type === "transit" ? l.shape : [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]]).forEach((c) => b.extend(c as [number, number]));
          map.fitBounds(b, { padding: 40, duration: 0, maxZoom: 15 });
          loadJourney();
        } else {
          loadExplore();
          if (props.current.autoLocate && !props.current.focus)
            geoAllowed().then((ok) => {
              if (ok && !disposed) geo.trigger();
            });
        }
      });

      tick = setInterval(render, 1000);
      refresh = setInterval(() => (props.current.mode === "explore" ? loadExplore() : props.current.mode === "line" ? loadLine() : loadJourney()), 30000);
      el.current.addEventListener("click", (ev) => {
        const b = (ev.target as HTMLElement).closest("[data-line]") as HTMLElement | null;
        if (!b) return;
        props.current.onLine?.({ pattern: +b.dataset.line!, tripId: b.dataset.trip!, date: b.dataset.date! });
      });
      (map as any)._afsted = { drawPins, drawJourney, drawLine, fitLine, loadLine, render, vehicles };
    })();

    return () => {
      disposed = true;
      clearInterval(tick);
      clearInterval(refresh);
      clearTimeout(deb);
      popup.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !m.isStyleLoaded() || (m as any)._style === p.theme) return;
    (m as any)._style = p.theme;
    m.setStyle(p.theme === "dark" ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11");
  }, [p.theme]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !p.rt) return;
    const vs: Map<string, VehicleTrip> | undefined = (m as any)._afsted?.vehicles?.current;
    if (!vs) return;
    for (const [k, r] of Object.entries(p.rt)) {
      const v = vs.get(k);
      if (v && r) v.rt = r;
    }
    (m as any)._afsted.render();
  }, [p.rt]);

  useEffect(() => {
    const a = mapRef.current && (mapRef.current as any)._afsted;
    a?.drawPins();
  }, [p.pins?.from?.[0], p.pins?.from?.[1], p.pins?.to?.[0], p.pins?.to?.[1], p.pins?.drop?.[0], p.pins?.drop?.[1]]);

  useEffect(() => {
    const m = mapRef.current;
    const a = m && (m as any)._afsted;
    if (!a || p.mode !== "line") return;
    a.drawLine();
    a.fitLine();
  }, [p.line]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !p.focus) return;
    m.easeTo({ center: [p.focus[1], p.focus[0]], zoom: Math.max(m.getZoom(), 14.5), duration: 600 });
  }, [p.focus?.[0], p.focus?.[1]]);

  return (
    <div className="map" style={{ height: p.height }}>
      <div ref={el} className="mapbox" />
      {err && <div className="map-err">{err}</div>}
      {p.mode === "explore" && zoomHint && !err && <div className="hint">Zoom ind for at se busser og tog live</div>}
    </div>
  );
}
