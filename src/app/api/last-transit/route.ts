import { NextRequest, NextResponse } from "next/server";

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

export interface LastTransitInfo {
  stopCode: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  lastDeparture: string | null;   // ISO string — when you'd need to leave the venue
  lastArrival: string | null;     // ISO string — when you'd arrive at the stop
  durationMinutes: number | null;
  available: boolean;             // false if no transit found at that hour
  warning: boolean;               // true if game might run past last departure
}

// Cache: key -> { data, ts }
const cache = new Map<string, { data: LastTransitInfo[]; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

async function checkTransitAt(
  venueLat: number, venueLng: number,
  stopLat: number, stopLng: number,
  departEpoch: number
): Promise<{
  departureTime: number | null;
  arrivalTime: number | null;
  durationMin: number | null;
} | null> {
  if (!GOOGLE_API_KEY) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${venueLat},${venueLng}&destination=${stopLat},${stopLng}&mode=transit&departure_time=${departEpoch}&key=${GOOGLE_API_KEY}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const leg = data?.routes?.[0]?.legs?.[0];
    if (!leg?.duration?.value) return null;

    return {
      departureTime: leg.departure_time?.value ?? null,
      arrivalTime: leg.arrival_time?.value ?? null,
      durationMin: Math.round(leg.duration.value / 60),
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const venueLat = parseFloat(sp.get("venueLat") ?? "");
  const venueLng = parseFloat(sp.get("venueLng") ?? "");
  const tipoffUtc = sp.get("tipoffUtc") ?? "";
  // stops: JSON array of {code, name, lat, lng}
  const stopsJson = sp.get("stops") ?? "[]";

  if (isNaN(venueLat) || isNaN(venueLng) || !tipoffUtc) {
    return NextResponse.json({ lastTransit: [] });
  }

  let stops: { code: string; name: string; lat: number; lng: number }[];
  try {
    stops = JSON.parse(stopsJson);
  } catch {
    return NextResponse.json({ lastTransit: [] });
  }

  if (stops.length === 0) return NextResponse.json({ lastTransit: [] });

  const cacheKey = `${venueLat.toFixed(3)},${venueLng.toFixed(3)},${tipoffUtc},${stops.map((s) => s.code).join(",")}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ lastTransit: cached.data });
  }

  const tipoffMs = new Date(tipoffUtc).getTime();
  // NBA game ~2.5 hours; check transit departing at game end + 30min buffer
  const gameEndEpoch = Math.floor((tipoffMs + 3 * 3600000) / 1000);
  // Also check a late departure (11 PM local-ish — 3.5h after tipoff as proxy)
  const lateEpoch = Math.floor((tipoffMs + 3.5 * 3600000) / 1000);

  const results: LastTransitInfo[] = [];

  // Process stops sequentially to avoid rate limits (max ~6 stops)
  for (const stop of stops.slice(0, 6)) {
    // Check at game end time
    const gameEndResult = await checkTransitAt(venueLat, venueLng, stop.lat, stop.lng, gameEndEpoch);
    // Check late departure
    const lateResult = await checkTransitAt(venueLat, venueLng, stop.lat, stop.lng, lateEpoch);

    // Use the later result that still has transit available
    const best = lateResult ?? gameEndResult;
    const lastDep = best?.departureTime ? best.departureTime : gameEndResult?.departureTime ?? null;
    const lastArr = best?.arrivalTime ? best.arrivalTime : gameEndResult?.arrivalTime ?? null;

    // Warn if the last departure is before game likely ends (~2.5h after tipoff)
    const estGameEnd = tipoffMs + 2.5 * 3600000;
    const warning = lastDep != null && (lastDep * 1000) < estGameEnd;

    results.push({
      stopCode: stop.code,
      stopName: stop.name,
      stopLat: stop.lat,
      stopLng: stop.lng,
      lastDeparture: lastDep ? new Date(lastDep * 1000).toISOString() : null,
      lastArrival: lastArr ? new Date(lastArr * 1000).toISOString() : null,
      durationMinutes: best?.durationMin ?? null,
      available: best != null,
      warning,
    });
  }

  cache.set(cacheKey, { data: results, ts: Date.now() });
  return NextResponse.json({ lastTransit: results });
}
