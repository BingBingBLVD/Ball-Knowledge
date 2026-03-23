import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.FLIGHTAWARE_API_KEY ?? "";
const BASE_URL = "https://aeroapi.flightaware.com/aeroapi";

export interface AirportDelay {
  code: string;
  name: string;
  delayIndex: number | null;       // 1-5 scale
  departureDel: number | null;     // avg departure delay in minutes
  arrivalDel: number | null;       // avg arrival delay in minutes
  reasons: string[];
}

// Cache: code -> { data, ts }
const cache = new Map<string, { data: AirportDelay; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

async function fetchAirportDelay(iataCode: string): Promise<AirportDelay> {
  const cached = cache.get(iataCode);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const fallback: AirportDelay = {
    code: iataCode,
    name: iataCode,
    delayIndex: null,
    departureDel: null,
    arrivalDel: null,
    reasons: [],
  };

  if (!API_KEY || API_KEY === "YOUR_KEY_HERE") return fallback;

  try {
    const url = `${BASE_URL}/airports/${iataCode}/delays`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "x-apikey": API_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // If 404 or similar, cache as no-delay
      cache.set(iataCode, { data: fallback, ts: Date.now() });
      return fallback;
    }

    const data = await res.json();
    const delays = data?.delays ?? [];

    // FlightAware delays response structure
    let depDelay: number | null = null;
    let arrDelay: number | null = null;
    let delayIndex: number | null = null;
    const reasons: string[] = [];

    // Parse delay data from FlightAware
    if (Array.isArray(delays) && delays.length > 0) {
      for (const d of delays) {
        if (d.type === "departure" && d.delay != null) {
          depDelay = Math.round(d.delay / 60); // seconds to minutes
        }
        if (d.type === "arrival" && d.delay != null) {
          arrDelay = Math.round(d.delay / 60);
        }
        if (d.delay_index != null) {
          delayIndex = d.delay_index;
        }
        if (d.reason) reasons.push(d.reason);
      }
    }

    const result: AirportDelay = {
      code: iataCode,
      name: data.airport_name ?? iataCode,
      delayIndex,
      departureDel: depDelay,
      arrivalDel: arrDelay,
      reasons,
    };

    cache.set(iataCode, { data: result, ts: Date.now() });
    return result;
  } catch {
    cache.set(iataCode, { data: fallback, ts: Date.now() });
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const codes = sp.get("codes")?.split(",").filter(Boolean) ?? [];

  if (codes.length === 0) {
    return NextResponse.json({ delays: [] });
  }

  // Fetch delays for all airports in parallel
  const delays = await Promise.all(codes.map((c) => fetchAirportDelay(c.trim().toUpperCase())));

  return NextResponse.json({ delays });
}
