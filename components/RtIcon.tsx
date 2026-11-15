import type { Realtime } from "@/lib/types";
import { Icon } from "./Icons";

export function RtIcon({ rt, sm }: { rt?: Realtime | null; sm?: boolean }) {
  const live = !!rt?.live;
  const title = live ? "Live-data fra Rejseplanen" : "Kun køreplan – ingen live-data";
  return (
    <span className={"rti" + (live ? " live" : " sched") + (sm ? " sm" : "")} title={title} aria-label={title}>
      <Icon name={live ? "live" : "clock"} />
    </span>
  );
}

export const rtIconHtml = (rt?: Realtime | null) =>
  rt?.live
    ? '<span class="rti live sm" title="Live-data"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg></span>'
    : '<span class="rti sched sm" title="Kun køreplan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>';
