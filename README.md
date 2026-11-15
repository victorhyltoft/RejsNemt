# Afsted

A personal journey planner for Zealand. It's a web app you add to your phone's home screen.

- **Route planning** runs on Rejseplanen's public GTFS timetable using our own planner (RAPTOR), so searches don't use API calls.
- **Live delays** come from Rejseplanen API 2.0, only for trips you're looking at, and are cached for 30 seconds.
- **Live map** (Mapbox) shows buses and trains moving along their routes. Each position is *estimated* from the timetable plus the latest known delay, the same way Google Maps does it for most operators.

## Deploy to Vercel (free Hobby plan)

1. Push this folder to a new **private** GitHub repo.
2. In Vercel: **Add New → Project → Import** the repo. The defaults are fine.
3. Add these under **Settings → Environment Variables**:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_MAPBOX_TOKEN` | Your Mapbox public token (`pk.…`). In Mapbox, restrict it to your Vercel URL. |
   | `APP_PASSCODE` | Any code. Locks the app so others can't use up your API quota. |
   | `REJSEPLANEN_API_KEY` | From Rejseplan Labs once approved. Leave empty until then. |
   | `REJSEPLANEN_API_BASE` | The API 2.0 base URL shown on Labs (default `https://www.rejseplanen.dk/api`). |
   | `MOCK_REALTIME` | `1` to show fake delays while you wait for the key. Remove it once the key is in. |

4. Deploy. The build downloads the timetable, filters it to Zealand and bakes it into the app (takes a few minutes).
5. On your phone, open the URL → Share → **Add to Home Screen**.

### Keep the timetable fresh

The timetable file only covers a few months, so it's rebuilt on every deploy. To redeploy weekly:

1. Vercel → Settings → Git → **Deploy Hooks** → create one and copy the URL.
2. GitHub repo → Settings → Secrets → Actions → add `VERCEL_DEPLOY_HOOK` with that URL.

The included workflow (`.github/workflows/refresh-timetable.yml`) then redeploys every Monday at night.

## Run locally

```bash
pnpm install
pnpm dev                   # downloads and builds the real timetable the first time (a few minutes)
pnpm gtfs:sample           # optional: small fake network for quick testing instead
pnpm test                  # planner + vehicle position checks
```

`/api/status` shows the timetable date range and today's API call count.

## When the Rejseplanen key arrives

Everything API-specific lives in `lib/realtime.ts`. It calls `location.nearbystops` (to find Rejseplanen's stop ID for a station) and `departureBoard` (one call returns delays for every departure at a station), then matches each departure to our timetable by line name and scheduled time.

The field names follow Rejseplanen's HAFAS-based API 2.0, but they haven't been checked against a real response yet. If delays don't show up, compare one raw `departureBoard` response with `lineNames()` and `refreshStation()` and adjust them.

A daily safety cap (`RT_DAILY_LIMIT`, default 1500 calls) keeps you inside the free 50,000 calls/month.

**Worth checking:** if your API access includes a vehicle-position service, those positions can replace the estimates in `lib/vehicle-position.ts`.

## Coverage

`scripts/build-gtfs.ts` keeps every trip that stops at least once on Zealand (incl. Lolland-Falster and Møn). It keeps the whole trip, so IC trains to Odense/Aarhus and Øresund trains to Malmö still work. Change `BBOX` to widen it.
