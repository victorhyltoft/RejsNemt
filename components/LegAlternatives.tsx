"use client";
import { useEffect, useState } from "react";
import type { Realtime, TransitLeg } from "@/lib/types";
import { api, fmt } from "@/lib/client";
import { LineBadge } from "./LineBadge";

export type AltOption = { leg: TransitLeg; rt: Realtime | null };

export function LegAlternatives({ leg, after, onPick, busy }: { leg: TransitLeg; after: number; onPick: (o: AltOption) => void; busy: boolean }) {
  const [opts, setOpts] = useState<AltOption[] | null>(null);
  useEffect(() => {
    let live = true;
    api.alternatives(leg.from.station, leg.to.station, after).then((r) => live && setOpts(r.options)).catch(() => live && setOpts([]));
    return () => { live = false; };
  }, [leg.from.station, leg.to.station, Math.round(after / 60000)]);

  if (!opts || opts.length < 2) return null;
  return (
    <div className="alts">
      <div className="alts-h">Andre afgange herfra til {leg.to.name}</div>
      <div className="chips alts-row">
        {opts.map((o) => {
          const cur = o.leg.tripId === leg.tripId && o.leg.serviceDate === leg.serviceDate;
          const dl = o.rt?.delay ?? 0;
          return (
            <button key={o.leg.tripId + o.leg.serviceDate} className={"chip alt" + (cur ? " on" : "")} disabled={busy || cur} onClick={() => onPick(o)}>
              <LineBadge r={o.leg.route} sm />
              <span className="alt-t">
                <b>{fmt(o.leg.dep + dl * 1000)}</b>
                {dl >= 60 ? <em className="late">+{Math.round(dl / 60)}</em> : o.rt?.cancelled ? <em className="late">aflyst</em> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
