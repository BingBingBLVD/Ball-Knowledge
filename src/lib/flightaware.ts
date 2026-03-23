/**
 * Flight schedule data via FlightRadar24 airport schedule endpoint.
 * No API key required — uses the public schedule plugin.
 *
 * Note: The endpoint returns flights from "now" through ~36 hours ahead.
 * Future-date lookups beyond that window will return empty results;
 * callers should fall back to a Google Flights link.
 */

export interface FlightResult {
  ident: string; // e.g. "UA123"
  airline: string; // e.g. "UA"
  flightNumber: string; // e.g. "123"
  originCode: string; // IATA e.g. "JFK"
  destCode: string; // IATA e.g. "LAX"
  scheduledOut: string; // ISO UTC gate departure
  scheduledIn: string; // ISO UTC gate arrival
  durationMinutes: number;
  status: string;
  aircraftType: string | null;
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/json",
};

/** Max pages to fetch (100 departures each). 4 pages ≈ 400 departures. */
const MAX_PAGES = 4;

/**
 * Fetch one page of the FR24 airport schedule.
 * Returns the departures array and total page count.
 */
async function fetchPage(
  originIata: string,
  page: number
): Promise<{ departures: unknown[]; totalPages: number }> {
  const url = `https://api.flightradar24.com/common/v1/airport.json?code=${originIata}&plugin[]=schedule&page=${page}&limit=100`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return { departures: [], totalPages: 0 };

  const data = await res.json();
  const schedule =
    data?.result?.response?.airport?.pluginData?.schedule?.departures;
  const departures = schedule?.data ?? [];
  const total = schedule?.item?.total ?? 0;
  const limit = schedule?.item?.limit ?? 100;
  const totalPages = Math.ceil(total / limit);
  return { departures, totalPages };
}

/**
 * Fetch scheduled flights between two airports on a given date.
 * Paginates through FR24's public schedule endpoint and filters
 * departures by destination and date client-side.
 */
export async function fetchFlights(
  originIata: string,
  destIata: string,
  date: string
): Promise<FlightResult[]> {
  // Build date boundaries (start/end of requested day in UTC)
  const [y, m, d] = date.split("-").map(Number);
  const dayStartMs = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).getTime();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;

  try {
    console.log(`[fr24] Fetching ${originIata} → ${destIata} on ${date}`);

    const allDepartures: unknown[] = [];

    // Fetch page 1 first to learn total pages
    const first = await fetchPage(originIata, 1);
    allDepartures.push(...first.departures);
    const pagesToFetch = Math.min(first.totalPages, MAX_PAGES);

    // Fetch remaining pages in parallel
    if (pagesToFetch > 1) {
      const remaining = await Promise.all(
        Array.from({ length: pagesToFetch - 1 }, (_, i) =>
          fetchPage(originIata, i + 2)
        )
      );
      for (const r of remaining) allDepartures.push(...r.departures);
    }

    // Parse and filter
    const flights: FlightResult[] = [];

    for (const f of allDepartures) {
      const flight = (f as Record<string, unknown>)
        ?.flight as Record<string, unknown> | undefined;
      if (!flight) continue;

      // Filter to our destination airport
      const destAirport = (
        flight.airport as Record<string, unknown>
      )?.destination as Record<string, unknown> | undefined;
      const destCode = (destAirport?.code as Record<string, string>)?.iata;
      if (!destCode || destCode !== destIata) continue;

      // Skip cancelled
      const status = ((flight.status as Record<string, unknown>)?.text as string) ?? "";
      if (/cancel/i.test(status)) continue;

      const timeObj = (flight.time as Record<string, unknown>)
        ?.scheduled as Record<string, number> | undefined;
      const depTs = timeObj?.departure;
      const arrTs = timeObj?.arrival;
      if (!depTs || !arrTs) continue;

      const depTimeMs = depTs * 1000;
      const arrTimeMs = arrTs * 1000;

      // Filter to requested date
      if (depTimeMs < dayStartMs || depTimeMs >= dayEndMs) continue;

      const durationMinutes = Math.round((arrTimeMs - depTimeMs) / 60000);
      if (durationMinutes <= 0) continue;

      const ident =
        ((flight.identification as Record<string, unknown>)
          ?.number as Record<string, string>)?.default ?? "";
      const airline =
        ((flight.airline as Record<string, unknown>)
          ?.code as Record<string, string>)?.iata ?? "";

      flights.push({
        ident,
        airline,
        flightNumber: ident.replace(airline, ""),
        originCode: originIata,
        destCode: destIata,
        scheduledOut: new Date(depTimeMs).toISOString(),
        scheduledIn: new Date(arrTimeMs).toISOString(),
        durationMinutes,
        status: status || "Scheduled",
        aircraftType:
          ((flight.aircraft as Record<string, unknown>)
            ?.model as Record<string, string>)?.code ?? null,
      });
    }

    // Sort by departure time
    flights.sort(
      (a, b) =>
        new Date(a.scheduledOut).getTime() - new Date(b.scheduledOut).getTime()
    );

    console.log(
      `[fr24] Found ${flights.length} flights ${originIata} → ${destIata} (scanned ${allDepartures.length} departures across ${pagesToFetch} pages)`
    );
    return flights;
  } catch (err) {
    console.error("[fr24] Fetch error:", err);
    return [];
  }
}
