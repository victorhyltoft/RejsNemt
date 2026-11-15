import type { MouseEvent } from "react";
import type { RouteRef } from "@/lib/types";

export function LineBadge({ r, sm, onClick }: { r: Pick<RouteRef, "short" | "mode" | "color" | "text">; sm?: boolean; onClick?: () => void }) {
  const cls = `lb ${r.mode}${sm ? " sm" : ""}${onClick ? " tap" : ""}`;
  const style = { background: r.color, color: r.text };
  if (!onClick) return <span className={cls} style={style}>{r.short}</span>;
  return (
    <span
      role="button"
      tabIndex={0}
      className={cls}
      style={style}
      aria-label={`Vis linje ${r.short}`}
      onClick={(e: MouseEvent) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onClick(); } }}
    >
      {r.short}
    </span>
  );
}
