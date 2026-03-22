const API_KEY = process.env.FLIGHTAWARE_API_KEY ?? "";
const BASE_URL = "https://aeroapi.flightaware.com/aeroapi";

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
 * Uses FlightAware AeroAPI: GET /airports/{origin}/flights/to/{dest}
 *
 * @param originIata - Origin airport IATA code (e.g. "JFK")
 * @param destIata - Destination airport IATA code (e.g. "LAX")
 * @param date - Date string YYYY-MM-DD
 * @returns Array of flight results, sorted by departure time
 */
export async function fetchFlights(
  originIata: string,
  destIata: string,
  date: string
): Promise<FlightResult[]> {
  if (!API_KEY || API_KEY === "YOUR_KEY_HERE") {
    console.warn("[flightaware] No API key configured, skipping flight search");
    return [];
  }

  // Query for the full day: start=date, end=date+1
  const startDate = date; // YYYY-MM-DD
  const [y, m, d] = date.split("-").map(Number);
  const nextDay = new Date(y, m - 1, d + 1);
  const endDate = nextDay.toISOString().split("T")[0];

  const url = `${BASE_URL}/airports/${originIata}/flights/to/${destIata}?start=${startDate}&end=${endDate}&max_pages=2`;

  try {
    console.log(`[flightaware] Fetching ${originIata} → ${destIata} on ${date}`);
    const res = await fetch(url, {
      headers: { "x-apikey": API_KEY },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[flightaware] API error ${res.status}: ${text}`);
      return [];
    }

    const data = await res.json();
    const flights: FlightResult[] = [];

    for (const f of data.flights ?? []) {
      // Skip cancelled flights
      if (f.cancelled) continue;

      const scheduledOut = f.scheduled_out ?? f.estimated_out;
      const scheduledIn = f.scheduled_in ?? f.estimated_in;
      if (!scheduledOut || !scheduledIn) continue;

      const depTime = new Date(scheduledOut).getTime();
      const arrTime = new Date(scheduledIn).getTime();
      const durationMinutes = Math.round((arrTime - depTime) / 60000);
      if (durationMinutes <= 0) continue;

      flights.push({
        ident: f.ident_iata || f.ident || "",
        airline: f.operator_iata || f.operator || "",
        flightNumber: f.flight_number || "",
        originCode: f.origin?.code_iata || originIata,
        destCode: f.destination?.code_iata || destIata,
        scheduledOut,
        scheduledIn,
        durationMinutes,
        status: f.status || "Scheduled",
        aircraftType: f.aircraft_type || null,
      });
    }

    // Sort by departure time
    flights.sort(
      (a, b) =>
        new Date(a.scheduledOut).getTime() - new Date(b.scheduledOut).getTime()
    );

    console.log(`[flightaware] Found ${flights.length} flights ${originIata} → ${destIata}`);
    return flights;
  } catch (err) {
    console.error("[flightaware] Fetch error:", err);
    return [];
  }
}
