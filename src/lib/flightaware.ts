/**
 * Flight schedule data via FlightRadar24 airport schedule endpoint.
 * No API key required for basic schedule lookups.
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

/**
 * Fetch scheduled flights between two airports on a given date.
 * Uses FlightRadar24 airport schedule: departures from origin, filtered to dest.
 */
export async function fetchFlights(
  originIata: string,
  destIata: string,
  date: string
): Promise<FlightResult[]> {
  const [y, m, d] = date.split("-").map(Number);
  // Timestamp for start of day (UTC)
  const dayStart = Math.floor(new Date(y, m - 1, d, 0, 0, 0).getTime() / 1000);

  const url = `https://api.flightradar24.com/common/v1/airport.json?code=${originIata}&plugin[]=schedule&plugin-setting[schedule][mode]=departures&plugin-setting[schedule][timestamp]=${dayStart}&page=1&limit=100`;

  try {
    console.log(`[fr24] Fetching ${originIata} → ${destIata} on ${date}`);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BallKnowledge/1.0)",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[fr24] API error ${res.status}: ${text}`);
      return [];
    }

    const data = await res.json();
    const departures = data?.result?.response?.airport?.plugin?.schedule?.departures?.data ?? [];
    const flights: FlightResult[] = [];

    for (const f of departures) {
      const flight = f.flight;
      if (!flight) continue;

      // Filter to our destination airport
      const destAirport = flight.airport?.destination?.code?.iata;
      if (!destAirport || destAirport !== destIata) continue;

      // Skip cancelled
      const status = flight.status?.text ?? "";
      if (/cancel/i.test(status)) continue;

      const depTs = flight.time?.scheduled?.departure;
      const arrTs = flight.time?.scheduled?.arrival;
      if (!depTs || !arrTs) continue;

      const depTime = depTs * 1000;
      const arrTime = arrTs * 1000;
      const durationMinutes = Math.round((arrTime - depTime) / 60000);
      if (durationMinutes <= 0) continue;

      const ident = flight.identification?.number?.default ?? "";
      const airline = flight.airline?.code?.iata ?? "";

      flights.push({
        ident,
        airline,
        flightNumber: ident.replace(airline, ""),
        originCode: originIata,
        destCode: destIata,
        scheduledOut: new Date(depTime).toISOString(),
        scheduledIn: new Date(arrTime).toISOString(),
        durationMinutes,
        status: status || "Scheduled",
        aircraftType: flight.aircraft?.model?.code ?? null,
      });
    }

    // Sort by departure time
    flights.sort(
      (a, b) =>
        new Date(a.scheduledOut).getTime() - new Date(b.scheduledOut).getTime()
    );

    console.log(`[fr24] Found ${flights.length} flights ${originIata} → ${destIata}`);
    return flights;
  } catch (err) {
    console.error("[fr24] Fetch error:", err);
    return [];
  }
}
