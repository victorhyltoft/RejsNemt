import { timetable } from "@/lib/timetable";
import { usage } from "@/lib/realtime";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const tt = timetable();
  return json({
    timetable: { generatedAt: tt.j.generatedAt, source: tt.j.source, feedStart: tt.j.feedStart, days: tt.j.days, stations: tt.j.stations.id.length, trips: tt.j.trips.id.length },
    realtime: usage(),
  });
}
