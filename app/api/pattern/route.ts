import { timetable } from "@/lib/timetable";
import { patternGeo } from "@/lib/schedule";
import { bad, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").filter((x) => /^\d+$/.test(x)).map(Number).slice(0, 80);
  const tt = timetable();
  if (!ids.length) return bad("ids required");
  const patterns = ids.filter((p) => p < tt.j.patterns.route.length).map((p) => patternGeo(tt, p));
  return json({ patterns, v: tt.j.generatedAt }, 3600);
}
