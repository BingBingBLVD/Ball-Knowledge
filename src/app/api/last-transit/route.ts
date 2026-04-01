import { NextRequest, NextResponse } from "next/server";

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

/** Fetch driving duration from OSRM as proxy for transit time */
async function estimateTransitViaOsrm(
  venueLat: number, venueLng: number,
  stopLat: number, stopLng: number,
): Promise<number | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${venueLng},${venueLat};${stopLng},${stopLat}?overview=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const duration = data?.routes?.[0]?.duration;
    if (duration == null) return null;
    // Transit is roughly 1.5x driving time
    return Math.round((duration / 60) * 1.5);
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

  const cacheKeyStr = `${venueLat.toFixed(3)},${venueLng.toFixed(3)},${tipoffUtc},${stops.map((s) => s.code).join(",")}`;
  const cached = cache.get(cacheKeyStr);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ lastTransit: cached.data });
  }

  const tipoffMs = new Date(tipoffUtc).getTime();
  // NBA game ~2.5 hours; estimate departure at game end + 30min buffer
  const gameEndMs = tipoffMs + 3 * 3600000;
  const estGameEnd = tipoffMs + 2.5 * 3600000;

  // Process stops in parallel
  const results: LastTransitInfo[] = await Promise.all(
    stops.slice(0, 6).map(async (stop) => {
      const durationMin = await estimateTransitViaOsrm(venueLat, venueLng, stop.lat, stop.lng);

      if (durationMin == null) {
        return {
          stopCode: stop.code,
          stopName: stop.name,
          stopLat: stop.lat,
          stopLng: stop.lng,
          lastDeparture: null,
          lastArrival: null,
          durationMinutes: null,
          available: false,
          warning: false,
        };
      }

      // Estimate: depart at game end, arrive durationMin later
      const departureMs = gameEndMs;
      const arrivalMs = departureMs + durationMin * 60000;
      const warning = departureMs < estGameEnd;

      return {
        stopCode: stop.code,
        stopName: stop.name,
        stopLat: stop.lat,
        stopLng: stop.lng,
        lastDeparture: new Date(departureMs).toISOString(),
        lastArrival: new Date(arrivalMs).toISOString(),
        durationMinutes: durationMin,
        available: true,
        warning,
      };
    })
  );

  cache.set(cacheKeyStr, { data: results, ts: Date.now() });
  return NextResponse.json({ lastTransit: results });
}
