"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NetworkJson } from "@/lib/format";
import type { Departure, Itinerary, Realtime, TransitLeg } from "@/lib/types";
import { MODE_LABEL, type Mode } from "@/lib/modes";
import { api, distKm, distTxt, dur, findStation, fmt, ld, loadNetwork, localFromMs, localParam, locate, mins, nearby, placeName, rtKey, rtStatus, searchStations, sv, until, walkTxt, type Place, type Station } from "@/lib/client";
import { RtIcon } from "./RtIcon";
import { Icon, modeIcon } from "./Icons";
import { LineBadge } from "./LineBadge";
import { LegAlternatives, type AltOption } from "./LegAlternatives";
import type { LineQuery } from "./LineSheet";

const LineSheet = dynamic(() => import("./LineSheet"), { ssr: false });

const LiveMap = dynamic(() => import("./LiveMap"), { ssr: false, loading: () => <div className="map skeleton" /> });

type View = "home" | "results" | "detail" | "deps" | "map" | "saved";
type Ref = { i: number; n: string; ll?: [number, number] };
type OpenLine = (q: LineQuery) => void;
const HERE_NAME = "Min position";
const PIN_NAME = "Valgt sted";
const place = (r: Ref): Place => (r.i < 0 && r.ll ? { ll: r.ll, name: r.n } : r.i);
const samePlace = (a: Ref, b: Ref) => (a.i >= 0 || b.i >= 0 ? a.i === b.i : !!a.ll && !!b.ll && a.ll[0] === b.ll[0] && a.ll[1] === b.ll[1]);
type Pair = { from: Ref; to: Ref };
type Sheet = { type: "st"; f: "from" | "to" | "board" | "home" | "work" } | { type: "time" } | null;

const POPULAR = ["København H", "Nørreport", "Lyngby", "DTU", "Kongens Nytorv", "Østerport", "Lufthavnen", "CPH Lufthavn", "Hellerup", "Roskilde"];

function greet() {
  const h = new Date().getHours();
  return h < 5 ? "God nat" : h < 10 ? "God morgen" : h < 12 ? "God formiddag" : h < 18 ? "God eftermiddag" : "God aften";
}

function useNow(ms = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function App() {
  const [net, setNet] = useState<NetworkJson | null>(null);
  const [netErr, setNetErr] = useState(false);
  const [view, setView] = useState<View>("home");
  const [from, setFrom] = useState<Ref | null>(null);
  const [to, setTo] = useState<Ref | null>(null);
  const [mode, setMode] = useState<"dep" | "arr">("dep");
  const [time, setTime] = useState<number | null>(null);
  const [day, setDay] = useState(0);
  const [results, setResults] = useState<Itinerary[]>([]);
  const [searchAt, setSearchAt] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [rt, setRt] = useState<Record<string, Realtime | null>>({});
  const [filter, setFilter] = useState("all");
  const [board, setBoard] = useState<Ref | null>(null);
  const [bmode, setBmode] = useState<"all" | Mode>("all");
  const [saved, setSaved] = useState<Pair[]>([]);
  const [recent, setRecent] = useState<Pair[]>([]);
  const [favs, setFavs] = useState<{ home: Ref | null; work: Ref | null }>({ home: null, work: null });
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [mapSel, setMapSel] = useState<number | null>(null);
  const [here, setHere] = useState<{ ll: [number, number]; label: string } | null>(null);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [toastMsg, setToast] = useState("");
  const [line, setLine] = useState<LineQuery | null>(null);
  const [pick, setPick] = useState<"from" | "to" | null>(null);
  const [drop, setDrop] = useState<{ ll: [number, number]; name: string } | null>(null);
  const openLine: OpenLine = useCallback((q) => setLine(q), []);
  const toastT = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(""), 1900);
  }, []);
  useEffect(() => {
    const h = (e: Event) => toast((e as CustomEvent).detail);
    window.addEventListener("afsted-toast", h);
    return () => window.removeEventListener("afsted-toast", h);
  }, [toast]);

  const restored = useRef(false);
  useEffect(() => {
    loadNetwork().then((n) => {
      const fix = (r: Ref | null) => {
        const s = findStation(n.stations, r);
        return s ? { i: s.i, n: s.n } : null;
      };
      const fixPair = (p: Pair) => {
        const a = fix(p.from), b = fix(p.to);
        return a && b ? { from: a, to: b } : null;
      };
      setNet(n);
      setFrom(fix(ld("from", null)));
      setBoard(fix(ld("board", null)) || fix({ i: -1, n: "Nørreport St." }) || fix({ i: -1, n: "Nørreport" }) || { i: n.stations[0].i, n: n.stations[0].n });
      setSaved(ld<Pair[]>("saved", []).map(fixPair).filter(Boolean) as Pair[]);
      setRecent(ld<Pair[]>("recent", []).map(fixPair).filter(Boolean) as Pair[]);
      const f = ld<{ home: Ref | null; work: Ref | null }>("favs", { home: null, work: null });
      setFavs({ home: fix(f.home), work: fix(f.work) });
      const lastFrom = fix(ld("from", null)), lastTo = fix(ld("to", null));
      setTo(lastTo);
      setBmode(ld<"all" | Mode>("bmode", "all"));
      const h = ld<{ ll: [number, number]; at: number } | null>("here", null);
      if (h) setHere({ ll: h.ll, label: Date.now() - h.at < 15 * 60e3 ? "dig" : "din seneste position" });
      const v = ld<View>("view", "home");
      if ((v === "results" || v === "detail") && lastFrom && lastTo && lastFrom.i !== lastTo.i) search(lastFrom, lastTo, { time: null, mode: "dep" });
      else if (v === "map" || v === "deps" || v === "saved") setView(v);
      restored.current = true;
    }).catch(() => setNetErr(true));
    const t = ld<"light" | "dark" | null>("theme", null) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(t);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (restored.current) sv("view", view);
  }, [view]);
  useEffect(() => {
    if (restored.current) sv("bmode", bmode);
  }, [bmode]);
  const onLocate = useCallback((ll: [number, number]) => {
    setHere({ ll, label: "dig" });
    sv("here", { ll, at: Date.now() });
  }, []);

  const stationById = useCallback((i: number) => net?.stations[i], [net]);
  const ref = (s: Station): Ref => ({ i: s.i, n: s.n });

  const search = useCallback(
    async (f: Ref | null = from, t: Ref | null = to, opts?: { time?: string | null; mode?: "dep" | "arr" }) => {
      if (!f || !t) return toast("Vælg både start og destination");
      if (samePlace(f, t)) return toast("Start og destination er den samme");
      const m = opts?.mode ?? mode;
      const param = opts && "time" in opts ? opts.time! : localParam(time, day);
      setLoading(true);
      setView("results");
      setFilter("all");
      setResults([]);
      scrollTo(0, 0);
      try {
        const r = await api.plan(place(f), place(t), param, m === "arr");
        setResults(r.itineraries);
        setSearchAt(param || "");
        const keys = r.itineraries.flatMap((it) => it.legs.filter((l): l is TransitLeg => l.type === "transit").slice(0, 1).map((l) => rtKey(l.tripId, l.serviceDate)));
        if (keys.length) api.rt(keys.slice(0, 8)).then((x) => setRt((o) => ({ ...o, ...x.rt }))).catch(() => {});
      } catch (e) {
        toast("Kunne ikke finde rejser");
      } finally {
        setLoading(false);
      }
      if (f.i < 0 || t.i < 0) return;
      const pair = { from: f, to: t };
      setRecent((r) => {
        const n = [pair, ...r.filter((x) => !(x.from.i === f.i && x.to.i === t.i))].slice(0, 5);
        sv("recent", n);
        return n;
      });
      if (f.i >= 0) sv("from", f);
      if (t.i >= 0) sv("to", t);
    },
    [from, to, mode, time, day, toast],
  );

  const legsKeys = useMemo(() => {
    const it = results[sel];
    return it ? it.legs.filter((l): l is TransitLeg => l.type === "transit").map((l) => rtKey(l.tripId, l.serviceDate)) : [];
  }, [results, sel]);

  useEffect(() => {
    if (view !== "detail" || !legsKeys.length) return;
    const load = () => api.rt(legsKeys).then((x) => setRt((o) => ({ ...o, ...x.rt }))).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [view, legsKeys]);

  const isSaved = !!(from && to && saved.some((x) => x.from.i === from.i && x.to.i === to.i));
  const toggleSave = () => {
    if (!from || !to) return;
    if (from.i < 0 || to.i < 0) return toast("Ruter med et sted på kortet kan ikke gemmes");
    const n = isSaved ? saved.filter((x) => !(x.from.i === from.i && x.to.i === to.i)) : [{ from, to }, ...saved];
    setSaved(n);
    sv("saved", n);
    toast(isSaved ? "Fjernet fra gemte" : "Rute gemt");
  };

  const setPoint = (kind: "from" | "to", ll: [number, number], name = PIN_NAME) => {
    const r: Ref = { i: -1, n: name, ll };
    const other = kind === "from" ? to : from;
    if (kind === "from") setFrom(r); else setTo(r);
    setPick(null);
    setDrop(null);
    if (other) search(kind === "from" ? r : other, kind === "from" ? other : r);
    else setView("home");
    if (name === PIN_NAME)
      placeName(ll).then((n) => {
        if (!n) return;
        const upd = (x: Ref | null) => (x && x.i < 0 && x.ll && x.ll[0] === ll[0] && x.ll[1] === ll[1] ? { ...x, n } : x);
        if (kind === "from") setFrom(upd); else setTo(upd);
      });
  };

  const chooseHere = async () => {
    const f = (sheet as any)?.f;
    setSheet(null);
    toast("Finder din position…");
    try {
      const ll = await locate();
      const r: Ref = { i: -1, n: HERE_NAME, ll };
      setFrom(r);
      setToast("");
      if (f === "from" && to) search(r, to);
    } catch {
      toast("Kunne ikke finde din position");
    }
  };

  const choose = (s: Station) => {
    const f = (sheet as any)?.f;
    setSheet(null);
    const r = ref(s);
    if (f === "from") setFrom(r);
    if (f === "to") {
      setTo(r);
      if (from && from.i !== r.i) search(from, r);
    }
    if (f === "board") {
      setBoard(r);
      sv("board", r);
      setBmode("all");
    }
    if (f === "home" || f === "work") {
      const n = { ...favs, [f]: r };
      setFavs(n);
      sv("favs", n);
    }
  };

  if (netErr)
    return (
      <div className="boot"><div className="empty"><b>Køreplanen mangler</b>Kør <code>pnpm gtfs</code> i projektmappen og genstart appen.</div></div>
    );
  if (!net) return <div className="boot"><div className="spin" /></div>;

  const content = (() => {
    switch (view) {
      case "home":
        return (
          <Home
            from={from} to={to} mode={mode} time={time} day={day} favs={favs} recent={recent} saved={saved} theme={theme}
            onPick={(f) => setSheet({ type: "st", f })}
            onSwap={() => { setFrom(to); setTo(from); }}
            onTime={() => setSheet({ type: "time" })}
            onSearch={() => search()}
            onPair={(p) => { setFrom(p.from); setTo(p.to); search(p.from, p.to); }}
            onFav={(k) => {
              const target = favs[k];
              if (!target) return setSheet({ type: "st", f: k });
              let f = from;
              if (!f || f.i === target.i) f = (k === "home" ? favs.work : favs.home) || f;
              setTo(target);
              if (f) { setFrom(f); search(f, target); }
            }}
            onMap={() => setView("map")}
            onTheme={() => { const t = theme === "dark" ? "light" : "dark"; setTheme(t); sv("theme", t); }}
          />
        );
      case "results":
        return (
          <Results
            from={from!} to={to!} mode={mode} searchAt={searchAt} results={results} loading={loading} rt={rt} filter={filter} saved={isSaved}
            onBack={() => setView("home")} onSave={toggleSave} onFilter={setFilter} onLine={openLine}
            onOpen={(i) => { setSel(i); setView("detail"); scrollTo(0, 0); }}
            onPage={(dir) => {
              if (!results.length) return;
              const ms = dir > 0 ? results[results.length - 1].dep + 60e3 : results[0].dep - 30 * 60e3;
              const d = new Date(ms);
              const p = (n: number) => String(n).padStart(2, "0");
              setMode("dep");
              search(from, to, { mode: "dep", time: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` });
            }}
          />
        );
      case "detail":
        return (
          <Detail
            it={results[sel]} from={from!} to={to!} rt={rt} net={net} theme={theme} saved={isSaved} onLine={openLine}
            onReplace={(n) => setResults((rs) => rs.map((x, k) => (k === sel ? n : x)))}
            onBack={() => setView("results")} onSave={toggleSave}
            onCopy={async () => {
              const it = results[sel];
              const txt = `${from!.n} → ${to!.n}\n${fmt(it.dep)}–${fmt(it.arr)} (${dur(mins(it.dep, it.arr))})\n` + it.legs.filter((l): l is TransitLeg => l.type === "transit").map((l) => `${fmt(l.dep)} ${l.route.short} mod ${l.headsign}: ${l.from.name} → ${l.to.name} (${fmt(l.arr)})`).join("\n");
              try { await navigator.clipboard.writeText(txt); toast("Rejse kopieret"); } catch { toast("Kunne ikke kopiere"); }
            }}
          />
        );
      case "deps":
        return <Deps board={board!} bmode={bmode} onLine={openLine} onMode={setBmode} onPick={() => setSheet({ type: "st", f: "board" })} onMap={() => { const s = stationById(board!.i)!; setMapSel(s.i); setFocus([s.la, s.lo]); setView("map"); }} />;
      case "map":
        return (
          <MapView
            net={net} theme={theme} mapSel={mapSel} here={here} home={favs.home} focus={focus} onLine={openLine}
            pick={pick} drop={drop} pins={{ from: from?.ll ?? (from ? [stationById(from.i)!.la, stationById(from.i)!.lo] : null), to: to?.ll ?? (to ? [stationById(to.i)!.la, stationById(to.i)!.lo] : null), drop: drop?.ll ?? null }}
            onCancelPick={() => setPick(null)}
            onPoint={(ll) => {
              if (pick) return setPoint(pick, ll);
              setMapSel(null);
              setDrop({ ll, name: PIN_NAME });
              placeName(ll).then((n) => n && setDrop((d) => (d && d.ll === ll ? { ...d, name: n } : d)));
            }}
            onDropUse={(kind) => drop && setPoint(kind, drop.ll, drop.name)}
            onDropClose={() => setDrop(null)}
            onSel={(i) => {
              const st = stationById(i);
              if (pick && st) {
                const r = ref(st);
                const other = pick === "from" ? to : from;
                if (pick === "from") setFrom(r); else setTo(r);
                setPick(null);
                if (other) search(pick === "from" ? r : other, pick === "from" ? other : r); else setView("home");
                return;
              }
              setDrop(null);
              setMapSel(i);
              if (st) setFocus([st.la, st.lo]);
            }}
            onClose={() => setMapSel(null)}
            onLocate={onLocate}
            onFrom={(i) => { const s = ref(stationById(i)!); setFrom(s); if (to && to.i !== s.i) search(s, to); else setView("home"); }}
            onTo={(i) => { const s = ref(stationById(i)!); setTo(s); if (from && from.i !== s.i) search(from, s); else setView("home"); }}
          />
        );
      case "saved":
        return (
          <Saved
            saved={saved} favs={favs} theme={theme}
            onGo={(p) => { setFrom(p.from); setTo(p.to); search(p.from, p.to); }}
            onRemove={(i) => { const n = saved.filter((_, k) => k !== i); setSaved(n); sv("saved", n); }}
            onPick={(f) => setSheet({ type: "st", f })}
            onTheme={(t) => { setTheme(t); sv("theme", t); }}
          />
        );
    }
  })();

  const tab = view === "deps" || view === "map" || view === "saved" ? view : "trip";
  return (
    <>
      <div id="app">{content}</div>
      <nav className="tabbar">
        {([["trip", "Rejse", "route", "home"], ["map", "Kort", "map", "map"], ["deps", "Afgange", "board", "deps"], ["saved", "Gemt", "bm", "saved"]] as const).map(([k, t, ic, v]) => (
          <button key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => { setView(v); scrollTo(0, 0); }}>
            <Icon name={ic} />
            {t}
          </button>
        ))}
      </nav>
      {sheet?.type === "st" && (
        <StationSheet
          net={net} f={sheet.f} favs={favs} recent={recent} onClose={() => setSheet(null)} onChoose={choose}
          onHere={sheet.f === "from" ? chooseHere : undefined}
          onMap={sheet.f === "from" || sheet.f === "to" ? () => { const f = sheet.f as "from" | "to"; setSheet(null); setPick(f); setMapSel(null); setView("map"); scrollTo(0, 0); } : undefined}
        />
      )}
      {line && <LineSheet net={net} theme={theme} q={line} onClose={() => setLine(null)} />}
      {sheet?.type === "time" && (
        <TimeSheet mode={mode} time={time} day={day} onClose={() => setSheet(null)} onApply={(m, t, d) => { setMode(m); setTime(t); setDay(d); setSheet(null); }} />
      )}
      <div className={"toast" + (toastMsg ? " show" : "")}>{toastMsg}</div>
    </>
  );
}

function timeLabel(mode: "dep" | "arr", time: number | null, day: number) {
  const m = mode === "dep" ? "Afgang" : "Ankomst";
  if (time == null) return `${m} nu`;
  return `${m} ${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}${day ? " i morgen" : ""}`;
}

function Home(p: {
  from: Ref | null; to: Ref | null; mode: "dep" | "arr"; time: number | null; day: number; favs: { home: Ref | null; work: Ref | null }; recent: Pair[]; saved: Pair[]; theme: string;
  onPick: (f: "from" | "to") => void; onSwap: () => void; onTime: () => void; onSearch: () => void; onPair: (p: Pair) => void; onFav: (k: "home" | "work") => void; onMap: () => void; onTheme: () => void;
}) {
  const [spin, setSpin] = useState(false);
  return (
    <div className="fadein">
      <div className="top">
        <div>
          <div className="hello">{greet()}</div>
          <h1>Hvor skal du hen?</h1>
        </div>
        <button className="icon-btn" onClick={p.onTheme} aria-label="Skift tema"><Icon name={p.theme === "dark" ? "sun" : "moon"} /></button>
      </div>
      <div className="card plan">
        <button className="fld" onClick={() => p.onPick("from")}>
          <span className="dot o" />
          <span><small>Fra</small><b className={p.from ? "" : "ph"}>{p.from?.n || "Vælg start"}</b></span>
        </button>
        <div className="div" />
        <button className="fld" onClick={() => p.onPick("to")}>
          <span className="dot d" />
          <span><small>Til</small><b className={p.to ? "" : "ph"}>{p.to?.n || "Vælg destination"}</b></span>
        </button>
        <button className={"swap" + (spin ? " spin" : "")} aria-label="Byt" onClick={() => { setSpin(true); setTimeout(() => { setSpin(false); p.onSwap(); }, 250); }}>
          <Icon name="swap" />
        </button>
      </div>
      <div className="row">
        <button className="timebtn" onClick={p.onTime}><Icon name="clock" /><span>{timeLabel(p.mode, p.time, p.day)}</span></button>
        <button className="go" onClick={p.onSearch}>Find rejse</button>
      </div>
      <h2>Genveje</h2>
      <div className="chips">
        <button className="chip" onClick={() => p.onFav("home")}><span className="ic"><Icon name="home" /></span>{p.favs.home ? `Hjem · ${p.favs.home.n}` : "Vælg Hjem"}</button>
        <button className="chip" onClick={() => p.onFav("work")}><span className="ic"><Icon name="work" /></span>{p.favs.work ? `Arbejde · ${p.favs.work.n}` : "Vælg Arbejde"}</button>
        <button className="chip" onClick={p.onMap}><span className="ic"><Icon name="map" /></span>Live-kort</button>
      </div>
      {!!p.saved.length && (
        <>
          <h2>Gemte ruter</h2>
          <div className="card list">
            {p.saved.map((x, i) => (
              <button key={i} className="item" onClick={() => p.onPair(x)}>
                <span className="lead" style={{ color: "#F5A524" }}><Icon name="star" /></span>
                <span className="t"><b>{x.from.n} → {x.to.n}</b><span>Gemt rute</span></span>
                <span className="end"><Icon name="right" /></span>
              </button>
            ))}
          </div>
        </>
      )}
      {!!p.recent.length && (
        <>
          <h2>Seneste</h2>
          <div className="card list">
            {p.recent.map((x, i) => (
              <button key={i} className="item" onClick={() => p.onPair(x)}>
                <span className="lead"><Icon name="hist" /></span>
                <span className="t"><b>{x.to.n}</b><span>fra {x.from.n}</span></span>
                <span className="end"><Icon name="right" /></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function alertLike(msg: string) {
  window.dispatchEvent(new CustomEvent("afsted-toast", { detail: msg }));
}

function altAfter(legs: Itinerary["legs"], k: number, rt: Record<string, Realtime | null>) {
  for (let j = k - 1; j >= 0; j--) {
    const l = legs[j];
    if (l.type === "transit") return l.arr + (rt[rtKey(l.tripId, l.serviceDate)]?.delay ?? 0) * 1000 + 120e3;
  }
  const walk = k > 0 && legs[k - 1].type === "walk" ? legs[k - 1].arr - legs[k - 1].dep : 0;
  return Math.max(Date.now() + walk, legs[k].dep - 20 * 60e3);
}

function legDelay(l: TransitLeg, rt: Record<string, Realtime | null>) {
  return rt[rtKey(l.tripId, l.serviceDate)]?.delay ?? 0;
}

function Results(p: {
  from: Ref; to: Ref; mode: "dep" | "arr"; searchAt: string; results: Itinerary[]; loading: boolean; rt: Record<string, Realtime | null>; filter: string; saved: boolean;
  onBack: () => void; onSave: () => void; onFilter: (f: string) => void; onOpen: (i: number) => void; onPage: (d: number) => void; onLine: OpenLine;
}) {
  const now = useNow();
  let list = p.results.map((it, i) => ({ it, i }));
  if (p.filter === "few") { const m = Math.min(...list.map((x) => x.it.transfers)); list = list.filter((x) => x.it.transfers === m); }
  if (p.filter === "nobus") list = list.filter((x) => !x.it.legs.some((l) => l.type === "transit" && l.route.mode === "bus"));
  if (p.filter === "fast") list = [...list].sort((a, b) => a.it.arr - a.it.dep - (b.it.arr - b.it.dep));
  const sub = p.searchAt ? `${p.mode === "dep" ? "Afgang fra" : "Ankomst senest"} ${p.searchAt.slice(11, 16)}` : "Afgang nu";
  return (
    <>
      <div className="bar">
        <button className="icon-btn" onClick={p.onBack} aria-label="Tilbage"><Icon name="back" /></button>
        <div className="ttl"><b>{p.from.n} → {p.to.n}</b><span>{sub}</span></div>
        {p.from.i >= 0 && <button className={"icon-btn star" + (p.saved ? " on" : "")} onClick={p.onSave} aria-label="Gem"><Icon name="star" /></button>}
      </div>
      <div className="chips" style={{ margin: "2px 0 14px" }}>
        {([["all", "Alle", "list"], ["fast", "Hurtigst", "bolt"], ["few", "Færrest skift", "swap"], ["nobus", "Uden bus", "train"]] as const).map(([k, t, ic]) => (
          <button key={k} className={"chip" + (p.filter === k ? " on" : "")} onClick={() => p.onFilter(k)}><Icon name={ic} className="ci" />{t}</button>
        ))}
      </div>
      {p.loading && <div className="card empty"><div className="spin" />Finder rejser…</div>}
      {!p.loading && !list.length && <div className="empty"><b>Ingen rejser fundet</b>Prøv et andet tidspunkt eller fjern filteret.</div>}
      <div className="fadein">
        {list.map(({ it, i }) => {
          const legs = it.legs.filter((l): l is TransitLeg => l.type === "transit");
          const d0 = legs[0] ? legDelay(legs[0], p.rt) : 0;
          const total = it.arr - it.dep;
          let prev = it.dep;
          return (
            <button key={i} className="card jc" onClick={() => p.onOpen(i)}>
              <div className="r1"><span className="times">{fmt(it.dep)}<i>→</i>{fmt(it.arr)}</span><span className="dur">{dur(mins(it.dep, it.arr))}</span></div>
              <div className="r2">
                {legs.map((l, k) => (
                  <span key={k} className="ii">{k > 0 && <span className="chev">›</span>}<LineBadge r={l.route} onClick={() => p.onLine({ pattern: l.pattern, tripId: l.tripId, date: l.serviceDate })} /></span>
                ))}
                {d0 >= 60 && <span className="tag warn" style={{ marginLeft: "auto" }}>+{Math.round(d0 / 60)} min</span>}
              </div>
              <div className="segbar">
                {it.legs.flatMap((l, k) => {
                  const out = [];
                  if (l.dep > prev) out.push(<i key={k + "w"} className="seg wait" style={{ flex: (l.dep - prev) / total }} />);
                  out.push(<i key={k} className={"seg" + (l.type === "walk" ? " wait" : "")} style={{ flex: Math.max(0.02, (l.arr - l.dep) / total), background: l.type === "transit" ? l.route.color : undefined }} />);
                  prev = l.arr;
                  return out;
                })}
              </div>
              <div className="r3">
                <span className="ii">{legs[0] ? <RtIcon rt={p.rt[rtKey(legs[0].tripId, legs[0].serviceDate)]} sm /> : <Icon name="clock" />}{until(it.dep + d0 * 1000, now) || (legs[0]?.from.platform ? `Spor ${legs[0].from.platform}` : MODE_LABEL[legs[0]?.route.mode ?? "bus"])}</span>
                <span className="ii">{it.transfers ? <><Icon name="swap" />{it.transfers} skift</> : <><Icon name="bolt" />Direkte</>}</span>
              </div>
            </button>
          );
        })}
      </div>
      {!!p.results.length && (
        <div className="pager"><button onClick={() => p.onPage(-1)}>← Tidligere</button><button onClick={() => p.onPage(1)}>Senere →</button></div>
      )}
    </>
  );
}

function Detail(p: { it: Itinerary; from: Ref; to: Ref; rt: Record<string, Realtime | null>; net: NetworkJson; theme: "light" | "dark"; saved: boolean; onBack: () => void; onSave: () => void; onCopy: () => void; onLine: OpenLine; onReplace: (it: Itinerary) => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  const pick = async (k: number, o: AltOption) => {
    const it = p.it;
    const dest = it.legs[it.legs.length - 1].to;
    setBusy(true);
    try {
      const prefix = it.legs.slice(0, k).map((l) => ({ ...l }));
      const nl = o.leg;
      const last = prefix[prefix.length - 1];
      if (last && last.type === "walk") {
        const d = last.arr - last.dep;
        last.arr = nl.dep - 60e3;
        last.dep = last.arr - d;
      }
      let rest: Itinerary["legs"] = [];
      if (nl.to.station !== dest.station) {
        const delay = (o.rt?.delay ?? 0) * 1000;
        const destPlace: Place = dest.station < 0 ? { ll: [dest.lat, dest.lon], name: dest.name } : dest.station;
        const km = distKm([nl.to.lat, nl.to.lon], [dest.lat, dest.lon]);
        const r = await api.plan(nl.to.station, destPlace, localFromMs(nl.arr + delay + 60e3), false).catch(() => ({ itineraries: [] as Itinerary[] }));
        const best = [...r.itineraries].sort((a, b) => a.arr - b.arr)[0];
        const walkMs = Math.round(((km * 1000 * 1.3) / 1.25) * 1000);
        if (dest.station < 0 && km < 1.2 && (!best || nl.arr + walkMs <= best.arr)) {
          rest = [{ type: "walk", from: nl.to, to: dest, dep: nl.arr, arr: nl.arr + walkMs }];
        } else {
          if (!best) throw new Error("no continuation");
          rest = best.legs;
          if (rest[0].type === "transit") rest = [{ type: "walk", from: nl.to, to: rest[0].from, dep: nl.arr, arr: nl.arr + 120e3 }, ...rest];
        }
      }
      const legs = [...prefix, nl, ...rest];
      const transit = legs.filter((l) => l.type === "transit").length;
      p.onReplace({ dep: legs[0].dep, arr: legs[legs.length - 1].arr, transfers: transit - 1, legs });
      setOpen({});
    } catch {
      alertLike("Kunne ikke finde en videre rejse med den afgang");
    } finally {
      setBusy(false);
    }
  };
  const now = useNow();
  const it = p.it;
  if (!it) return null;
  const tr = it.transfers;
  const legs = it.legs;
  return (
    <>
      <div className="bar">
        <button className="icon-btn" onClick={p.onBack} aria-label="Tilbage"><Icon name="back" /></button>
        <div className="ttl"><b>Rejsedetaljer</b><span>{p.from.n} → {p.to.n}</span></div>
      </div>
      <div className="fadein">
        <div className="card sum">
          <div className="big">{fmt(it.dep)} – {fmt(it.arr)}</div>
          <div className="meta">
            <span className="ii"><Icon name="clock" />{dur(mins(it.dep, it.arr))}</span>·
            <span className="ii"><Icon name="swap" />{tr ? `${tr} skift` : "Direkte"}</span>
            {(() => { const f = it.legs.find((l): l is TransitLeg => l.type === "transit"); const u = until(it.dep + (f ? legDelay(f, p.rt) : 0) * 1000, now); return u ? <>·<span className="soon">{u}</span></> : null; })()}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <LiveMap network={p.net} theme={p.theme} height="260px" mode="journey" itinerary={it} rt={p.rt} />
        </div>
        <div className="card tl">
          {legs.map((l, k) => {
            if (l.type === "walk") {
              const same = l.from.station === l.to.station;
              const nextLeg = legs[k + 1];
              const prevLeg = legs[k - 1];
              const prevDelay = prevLeg?.type === "transit" ? legDelay(prevLeg, p.rt) : 0;
              const nextDelay = nextLeg?.type === "transit" ? legDelay(nextLeg, p.rt) : 0;
              const slack = nextLeg && prevLeg ? Math.round((nextLeg.dep + nextDelay * 1000 - prevLeg.arr - prevDelay * 1000) / 60000) : null;
              const walk = mins(l.dep, l.arr);
              return (
                <div key={k} className="xfer">
                  <div /><div className="nd" />
                  <div className="w">
                    <Icon name="walk" />
                    {same ? `Skift${slack !== null ? ` · ${Math.max(0, slack)} min` : ""}` : `Gå ${walk} min til ${l.to.name}`}
                    {slack !== null && slack - walk < 2 && <span className="tag warn">{slack - walk < 0 ? "Skift i fare" : "Kort skift"}</span>}
                  </div>
                </div>
              );
            }
            const r = p.rt[rtKey(l.tripId, l.serviceDate)];
            const dl = r?.delay ?? 0;
            const c = l.route.color;
            const st = rtStatus(r);
            const mids = l.stops.slice(1, -1);
            const isLast = k === legs.length - 1 || legs.slice(k + 1).every((x) => x.type === "walk" && x.from.station === x.to.station);
            return (
              <div key={k}>
                <div className="st">
                  <div className="tm">{dl >= 60 ? <>{fmt(l.dep + dl * 1000)}<s>{fmt(l.dep)}</s></> : fmt(l.dep)}</div>
                  <div className="nd"><span className="rail" style={{ background: c, top: 22, bottom: 0 }} /><span className="node" style={{ borderColor: c }} /></div>
                  <div className="nm"><b>{l.from.name}</b><span>{[l.from.where, r?.track ? `Spor ${r.track}` : l.from.platform ? `Spor ${l.from.platform}` : "", k === 0 ? until(l.dep + dl * 1000, now) : ""].filter(Boolean).join(" · ")}</span></div>
                </div>
                <div className="ride">
                  <div /><div className="nd"><span className="rail" style={{ background: c }} /></div>
                  <div className="info">
                    <div className="ln"><LineBadge r={l.route} onClick={() => p.onLine({ pattern: l.pattern, tripId: l.tripId, date: l.serviceDate })} /><span className="ii"><Icon name={modeIcon(l.route.mode)} />{MODE_LABEL[l.route.mode]} mod {l.headsign}</span></div>
                    <div className={"rtline " + st.cls}><RtIcon rt={r} sm />{st.label}{r?.source === "mock" ? " (demo)" : ""}</div>
                    <button className={"tog" + (open[k] ? " open" : "")} onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>
                      {mids.length ? `${mids.length} stop · ` : ""}{dur(mins(l.dep, l.arr))} {!!mids.length && <Icon name="down" />}
                    </button>
                    {open[k] && !!mids.length && (
                      <ul className="mids">{mids.map((s, j) => <li key={j}><em>{fmt(s.time + dl * 1000)}</em>{s.name}</li>)}</ul>
                    )}
                    <LegAlternatives leg={l} busy={busy} after={altAfter(legs, k, p.rt)} onPick={(o) => pick(k, o)} />
                  </div>
                </div>
                <div className="st">
                  <div className="tm">{fmt(l.arr + dl * 1000)}</div>
                  <div className="nd"><span className="rail" style={{ background: c, top: 0, height: 16 }} /><span className="node" style={{ borderColor: c, background: isLast ? c : undefined }} /></div>
                  <div className="nm"><b>{l.to.name}</b><span>{[isLast ? "Destination" : l.to.platform ? `Spor ${l.to.platform}` : "Stå af", l.to.where].filter(Boolean).join(" · ")}</span></div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="acts">
          <button onClick={p.onSave}><Icon name="star" className={p.saved ? "starred" : ""} />{p.saved ? "Gemt" : "Gem rute"}</button>
          <button onClick={p.onCopy}><Icon name="copy" />Kopiér</button>
        </div>
      </div>
    </>
  );
}

function useDepartures(station: number | null, limit?: number) {
  const [deps, setDeps] = useState<Departure[] | null>(null);
  useEffect(() => {
    if (station == null) return;
    let live = true;
    setDeps(null);
    const load = () => api.departures(station, limit).then((r) => live && setDeps(r.departures)).catch(() => live && setDeps([]));
    load();
    const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
  }, [station, limit]);
  return deps;
}

function DepRow({ d, now, onLine }: { d: Departure; now: number; onLine?: OpenLine }) {
  const dl = d.rt?.delay ?? 0;
  const m = Math.round((d.time + dl * 1000 - now) / 60000);
  const track = d.rt?.track || d.platform;
  return (
    <div className="dep">
      <div className="lbw"><LineBadge r={d.route} onClick={onLine ? () => onLine({ pattern: d.pattern, tripId: d.tripId, date: d.serviceDate }) : undefined} /></div>
      <div className="t">
        <b>{d.headsign}</b>
        <span className="ii"><Icon name={modeIcon(d.route.mode)} />{[MODE_LABEL[d.route.mode], track ? `Spor ${track}` : "", d.where].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="when">
        {d.rt?.cancelled ? <b className="late">Aflyst</b> : <b className={m <= 1 ? "soon" : ""}>{m <= 0 ? "Nu" : `${m} min`}</b>}
        <span className="ii" style={{ justifyContent: "flex-end" }}><RtIcon rt={d.rt} sm />{dl >= 60 ? <><s>{fmt(d.time)}</s>&nbsp;<span className="late">{fmt(d.time + dl * 1000)}</span></> : fmt(d.time)}</span>
      </div>
    </div>
  );
}

function Deps(p: { board: Ref; bmode: "all" | Mode; onLine: OpenLine; onMode: (m: "all" | Mode) => void; onPick: () => void; onMap: () => void }) {
  const deps = useDepartures(p.board.i, 60);
  const now = useNow(10000);
  const modes = [...new Set((deps || []).map((d) => d.route.mode))];
  // A remembered filter for a mode this station doesn't have would hide everything.
  const bmode = p.bmode !== "all" && deps?.length && !modes.includes(p.bmode) ? "all" : p.bmode;
  const list = (deps || []).filter((d) => (bmode === "all" || d.route.mode === bmode) && d.time + (d.rt?.delay ?? 0) * 1000 > now - 60e3).sort((a, b) => a.time + (a.rt?.delay ?? 0) * 1000 - b.time - (b.rt?.delay ?? 0) * 1000).slice(0, 30);
  const live = (deps || []).some((d) => d.rt?.source === "api");
  return (
    <>
      <div className="top"><div><div className="hello">{live ? <><span className="pulse" />Live-data</> : "Fra køreplanen"}</div><h1>Afgange</h1></div></div>
      <div className="card" style={{ display: "flex", alignItems: "center" }}>
        <button className="stationbtn" onClick={p.onPick}><Icon name="pin" /><b>{p.board.n}</b><Icon name="down" /></button>
        <button className="icon-btn soft" style={{ marginRight: 12 }} onClick={p.onMap} aria-label="Vis på kort"><Icon name="map" /></button>
      </div>
      <div className="chips" style={{ margin: "14px 0" }}>
        <button className={"chip" + (bmode === "all" ? " on" : "")} onClick={() => p.onMode("all")}><Icon name="list" className="ci" />Alle</button>
        {modes.map((m) => <button key={m} className={"chip" + (bmode === m ? " on" : "")} onClick={() => p.onMode(m)}><Icon name={modeIcon(m)} className="ci" />{MODE_LABEL[m]}</button>)}
      </div>
      <div className="card list fadein">
        {deps === null ? <div className="empty"><div className="spin" /></div> : list.length ? list.map((d) => <DepRow key={d.tripId + d.serviceDate} d={d} now={now} onLine={p.onLine} />) : <div className="empty"><b>Ingen afgange de næste 2 timer</b></div>}
      </div>
    </>
  );
}

function MapView(p: {
  net: NetworkJson; theme: "light" | "dark"; mapSel: number | null; here: { ll: [number, number]; label: string } | null; home: Ref | null; focus: [number, number] | null;
  onSel: (i: number) => void; onClose: () => void; onLocate: (ll: [number, number]) => void; onFrom: (i: number) => void; onTo: (i: number) => void; onLine: OpenLine;
  pick: "from" | "to" | null; drop: { ll: [number, number]; name: string } | null; pins: { from: [number, number] | null; to: [number, number] | null; drop: [number, number] | null };
  onCancelPick: () => void; onPoint: (ll: [number, number]) => void; onDropUse: (k: "from" | "to") => void; onDropClose: () => void;
}) {
  const deps = useDepartures(p.mapSel);
  const now = useNow(10000);
  const homeSt = p.home ? p.net.stations[p.home.i] : null;
  const origin = p.here || (homeSt ? { ll: [homeSt.la, homeSt.lo] as [number, number], label: "Hjem" } : null);
  const s = p.mapSel != null ? p.net.stations[p.mapSel] : null;
  const routes = p.net.routes;
  return (
    <>
      {p.pick ? (
        <div className="pickbar"><Icon name="pin" />Tryk på kortet eller en station for at vælge {p.pick === "from" ? "start" : "destination"}<button onClick={p.onCancelPick}>Annullér</button></div>
      ) : (
        <div className="top"><div><div className="hello">Busser og tog i realtid</div><h1>Kort</h1></div></div>
      )}
      <LiveMap network={p.net} theme={p.theme} height="min(56vh,480px)" mode="explore" focus={p.focus} start={p.here?.ll} autoLocate onStation={p.onSel} onLocate={p.onLocate} onLine={p.onLine} onPoint={p.onPoint} pins={p.pins} />
      <div className="legend"><span><RtIcon rt={{ live: true, delay: 0, at: 0, source: "api" }} sm />Live-data</span><span><RtIcon sm />Kun køreplan</span><span>Tryk for at sætte en nål</span></div>
      {p.drop && !s ? (
        <div className="card spanel fadein">
          <div className="hd">
            <span className="lead"><Icon name="pin" /></span>
            <div style={{ flex: 1, minWidth: 0 }}><b>{p.drop.name}</b><div className="sub" style={{ margin: 0 }}>Sted på kortet</div></div>
            <button className="icon-btn flat" onClick={p.onDropClose} aria-label="Luk"><Icon name="x" /></button>
          </div>
          {nearby(p.net.stations, p.drop.ll, 3).map(({ s: x, km }) => (
            <button key={x.i} className="item" style={{ padding: "10px 0" }} onClick={() => p.onSel(x.i)}>
              <span className="lead"><Icon name={modeIcon(routes[x.r[0]]?.m ?? "bus")} /></span>
              <span className="t"><b>{x.n}</b><span>{distTxt(km)}{walkTxt(km) ? ` · ${walkTxt(km)}` : ""}</span></span>
            </button>
          ))}
          <div className="acts">
            <button onClick={() => p.onDropUse("from")}><Icon name="route" />Rejs herfra</button>
            <button className="pri" onClick={() => p.onDropUse("to")}><Icon name="flag" />Rejs hertil</button>
          </div>
        </div>
      ) : s ? (
        <div className="card spanel fadein">
          <div className="hd">
            <span className="lead"><Icon name={modeIcon(routes[s.r[0]]?.m ?? "bus")} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{s.n}</b>
              <div className="lns">{s.r.slice(0, 10).map((r) => <LineBadge key={r} r={{ short: routes[r].s, mode: routes[r].m, color: routes[r].c, text: routes[r].t }} sm onClick={() => p.onLine({ route: r })} />)}</div>
            </div>
            <button className="icon-btn flat" onClick={p.onClose} aria-label="Luk"><Icon name="x" /></button>
          </div>
          {origin && <div className="ii sub"><Icon name="walk" />{distTxt(distKm(origin.ll, [s.la, s.lo]))} fra {origin.label}{walkTxt(distKm(origin.ll, [s.la, s.lo])) ? ` · ${walkTxt(distKm(origin.ll, [s.la, s.lo]))}` : ""}</div>}
          {deps === null ? <div className="empty" style={{ padding: 20 }}><div className="spin" /></div> : deps.slice(0, 4).map((d) => <DepRow key={d.tripId + d.serviceDate} d={d} now={now} onLine={p.onLine} />)}
          <div className="acts">
            <button onClick={() => p.onFrom(s.i)}><Icon name="route" />Rejs herfra</button>
            <button className="pri" onClick={() => p.onTo(s.i)}><Icon name="flag" />Rejs hertil</button>
          </div>
        </div>
      ) : origin ? (
        <>
          <h2>I nærheden af {origin.label}</h2>
          <div className="card list fadein">
            {nearby(p.net.stations, origin.ll, 6).map(({ s, km }) => (
              <button key={s.i} className="item" onClick={() => p.onSel(s.i)}>
                <span className="lead"><Icon name={modeIcon(routes[s.r[0]]?.m ?? "bus")} /></span>
                <span className="t"><b>{s.n}</b><span className="lns">{s.r.slice(0, 7).map((r) => <LineBadge key={r} r={{ short: routes[r].s, mode: routes[r].m, color: routes[r].c, text: routes[r].t }} sm />)}</span></span>
                <span className="dist"><b>{distTxt(km)}</b>{walkTxt(km)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="note">Tryk på positionsknappen på kortet for at se stationer i nærheden, eller vælg et Hjem under Gemt.</p>
      )}
    </>
  );
}

function Saved(p: { saved: Pair[]; favs: { home: Ref | null; work: Ref | null }; theme: string; onGo: (p: Pair) => void; onRemove: (i: number) => void; onPick: (f: "home" | "work") => void; onTheme: (t: "light" | "dark") => void }) {
  return (
    <>
      <div className="top"><div><div className="hello">Dine steder og ruter</div><h1>Gemt</h1></div></div>
      <h2>Steder</h2>
      <div className="card list">
        <button className="item" onClick={() => p.onPick("home")}><span className="lead"><Icon name="home" /></span><span className="t"><b>Hjem</b><span>{p.favs.home?.n || "Ikke valgt"}</span></span><span className="end"><Icon name="right" /></span></button>
        <button className="item" onClick={() => p.onPick("work")}><span className="lead"><Icon name="work" /></span><span className="t"><b>Arbejde</b><span>{p.favs.work?.n || "Ikke valgt"}</span></span><span className="end"><Icon name="right" /></span></button>
      </div>
      <h2>Ruter</h2>
      {p.saved.length ? (
        <div className="card list">
          {p.saved.map((x, i) => (
            <div key={i} className="item">
              <button className="t" style={{ textAlign: "left" }} onClick={() => p.onGo(x)}><b>{x.from.n} → {x.to.n}</b><span>Tryk for at søge</span></button>
              <button className="end" onClick={() => p.onRemove(i)} aria-label="Fjern"><Icon name="star" className="starred" /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card empty" style={{ padding: "30px 20px" }}><b>Ingen gemte ruter</b>Tryk på stjernen ved en søgning for at gemme den.</div>
      )}
      <h2>Udseende</h2>
      <div className="card" style={{ padding: 4 }}>
        <div className="segc" style={{ margin: 0, background: "none" }}>
          <button className={p.theme === "light" ? "on" : ""} onClick={() => p.onTheme("light")}>Lyst</button>
          <button className={p.theme === "dark" ? "on" : ""} onClick={() => p.onTheme("dark")}>Mørkt</button>
        </div>
      </div>
    </>
  );
}

function StationSheet(p: { net: NetworkJson; f: string; favs: { home: Ref | null; work: Ref | null }; recent: Pair[]; onClose: () => void; onChoose: (s: Station) => void; onHere?: () => void; onMap?: () => void }) {
  const [q, setQ] = useState("");
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inp.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);
  const byName = (n: string) => p.net.stations.find((s) => s.n === n) || p.net.stations.find((s) => s.n === n + " St.");
  const results = q.trim() ? searchStations(p.net.stations, q) : [];
  const title = ({ from: "Fra", to: "Til", board: "Station", home: "Hjem", work: "Arbejde" } as Record<string, string>)[p.f];
  const routes = p.net.routes;
  const Item = ({ s, icon }: { s: Station; icon?: "home" | "work" | "hist" }) => (
    <button className="item" onClick={() => p.onChoose(s)}>
      <span className="lead"><Icon name={icon || modeIcon(routes[s.r[0]]?.m ?? "bus")} /></span>
      <span className="t"><b>{s.n}</b><span className="lns">{s.r.slice(0, 7).map((r) => <LineBadge key={r} r={{ short: routes[r].s, mode: routes[r].m, color: routes[r].c, text: routes[r].t }} sm />)}</span></span>
    </button>
  );
  const recentSt = [...new Map(p.recent.flatMap((r) => [r.to, r.from]).map((r) => [r.i, r])).values()].slice(0, 4).map((r) => p.net.stations[r.i]).filter(Boolean);
  const popular = POPULAR.map(byName).filter(Boolean) as Station[];
  return (
    <>
      <div className="shbg" onClick={p.onClose} />
      <div className="sheet full">
        <div className="grab" />
        <div className="shh">
          <label className="srch"><Icon name="search" /><input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${title}: søg station`} autoComplete="off" onKeyDown={(e) => { if (e.key === "Enter" && results[0]) p.onChoose(results[0]); if (e.key === "Escape") p.onClose(); }} /></label>
          <button className="cx" onClick={p.onClose}>Annullér</button>
        </div>
        <div id="sl">
          {q.trim() ? (
            results.length ? results.map((s) => <Item key={s.i} s={s} />) : <div className="empty"><b>Ingen stationer</b>Prøv et andet navn.</div>
          ) : (
            <>
              {p.onHere && (
                <button className="item here" onClick={p.onHere}>
                  <span className="lead"><Icon name="target" /></span>
                  <span className="t"><b>{HERE_NAME}</b><span>Start fra hvor du er nu</span></span>
                </button>
              )}
              {p.onMap && (
                <button className="item here" onClick={p.onMap}>
                  <span className="lead"><Icon name="map" /></span>
                  <span className="t"><b>Vælg på kortet</b><span>Sæt en nål hvor du vil {p.f === "from" ? "starte" : "hen"}</span></span>
                </button>
              )}
              {(p.favs.home || p.favs.work) && <h2>Favoritter</h2>}
              {p.favs.home && p.net.stations[p.favs.home.i] && <Item s={p.net.stations[p.favs.home.i]} icon="home" />}
              {p.favs.work && p.net.stations[p.favs.work.i] && <Item s={p.net.stations[p.favs.work.i]} icon="work" />}
              {!!recentSt.length && <h2>Seneste</h2>}
              {recentSt.map((s) => <Item key={s.i} s={s} icon="hist" />)}
              {!!popular.length && <h2>Populære</h2>}
              {popular.map((s) => <Item key={s.i} s={s} />)}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function TimeSheet(p: { mode: "dep" | "arr"; time: number | null; day: number; onClose: () => void; onApply: (m: "dep" | "arr", t: number | null, d: number) => void }) {
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const [m, setM] = useState(p.mode);
  const [t, setT] = useState(p.time ?? nowMin());
  const [d, setD] = useState(p.day);
  const hhmm = `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  return (
    <>
      <div className="shbg" onClick={p.onClose} />
      <div className="sheet">
        <div className="grab" />
        <div className="tsheet">
          <h3>Hvornår vil du rejse?</h3>
          <div className="segc">
            <button className={m === "dep" ? "on" : ""} onClick={() => setM("dep")}>Afgang</button>
            <button className={m === "arr" ? "on" : ""} onClick={() => setM("arr")}>Ankomst</button>
          </div>
          <div className="chips">
            <button className="chip" onClick={() => p.onApply(m, null, 0)}><Icon name="bolt" className="ci" />Nu</button>
            {[15, 30, 60].map((x) => <button key={x} className="chip" onClick={() => { const v = nowMin() + x; setT(v % 1440); setD(v >= 1440 ? 1 : 0); }}><Icon name="clock" className="ci" />+{x === 60 ? "1 time" : `${x} min`}</button>)}
          </div>
          <input className="tin" type="time" value={hhmm} onChange={(e) => { const [a, b] = e.target.value.split(":").map(Number); if (!isNaN(a)) setT(a * 60 + b); }} />
          <div className="segc">
            <button className={!d ? "on" : ""} onClick={() => setD(0)}>I dag</button>
            <button className={d ? "on" : ""} onClick={() => setD(1)}>I morgen</button>
          </div>
          <button className="go" style={{ width: "100%" }} onClick={() => p.onApply(m, t, d)}>Brug tidspunkt</button>
        </div>
      </div>
    </>
  );
}

