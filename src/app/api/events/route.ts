import { NextResponse } from "next/server";
import { fetchNBAEvents, type TMEvent } from "@/lib/ticketmaster";
import { fetchNBAOdds, matchOddsToEvent, findTeamCode } from "@/lib/kalshi";
import { fetchNBAStandings, fetchEspnTickets } from "@/lib/espn";
import stadiumAirportsData from "../../../../data/stadium-airports.json";

interface AirportCoord {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface StadiumEntry {
  city: string;
  state: string;
  lat: number;
  lng: number;
  airports: AirportCoord[];
  trainStations?: AirportCoord[];
  busStations?: AirportCoord[];
}

const stadiumAirports: Record<string, StadiumEntry> = stadiumAirportsData as Record<string, StadiumEntry>;

function findStadiumEntry(venue: string, city: string, state: string): StadiumEntry | null {
  if (stadiumAirports[venue]) return stadiumAirports[venue];
  for (const entry of Object.values(stadiumAirports)) {
    if (
      entry.city.toLowerCase() === city.toLowerCase() &&
      entry.state.toLowerCase() === state.toLowerCase()
    ) {
      return entry;
    }
  }
  return null;
}

export const revalidate = 60; // revalidate every minute for fresh odds

function cheapestPrice(event: TMEvent) {
  if (!event.priceRanges?.length) return null;
  const lowest = event.priceRanges.reduce((min, pr) =>
    pr.min < min.min ? pr : min
  );
  return { amount: lowest.min, currency: lowest.currency };
}

function toEST(utcDateTime: string): { date: string; time: string } {
  const d = new Date(utcDateTime);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return {
    date: formatter.format(d),
    time: timeFormatter.format(d).replace(/\u202f/g, " "),
  };
}

const STATE_TZ: Record<string, string> = {
  // Eastern
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", IN: "America/Indiana/Indianapolis",
  KY: "America/New_York", MA: "America/New_York", MD: "America/New_York",
  ME: "America/New_York", MI: "America/Detroit", NC: "America/New_York",
  NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York",
  OH: "America/New_York", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", VA: "America/New_York", VT: "America/New_York",
  WV: "America/New_York", ON: "America/Toronto",
  // Central
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago",
  IL: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago",
  MN: "America/Chicago", MO: "America/Chicago", MS: "America/Chicago",
  NE: "America/Chicago", OK: "America/Chicago", TN: "America/Chicago",
  TX: "America/Chicago", WI: "America/Chicago",
  // Mountain
  CO: "America/Denver", MT: "America/Denver", NM: "America/Denver",
  UT: "America/Denver", WY: "America/Denver",
  AZ: "America/Phoenix",
  // Pacific
  CA: "America/Los_Angeles", NV: "America/Los_Angeles",
  OR: "America/Los_Angeles", WA: "America/Los_Angeles",
};

function toLocalTime(utcDateTime: string, stateCode: string): { time: string; tz: string } {
  const d = new Date(utcDateTime);
  const iana = STATE_TZ[stateCode] ?? "America/New_York";
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const tzFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    timeZoneName: "short",
  });
  const parts = tzFormatter.formatToParts(d);
  const tzAbbr = parts.find((p) => p.type === "timeZoneName")?.value ?? "ET";
  return {
    time: timeFormatter.format(d).replace(/\u202f/g, " "),
    tz: tzAbbr,
  };
}

export async function GET() {
  try {
    // Fetch TM events, Kalshi odds, and ESPN standings in parallel
    const [events, odds, standings] = await Promise.all([
      fetchNBAEvents(),
      fetchNBAOdds().catch(() => []), // don't fail if Kalshi is down
      fetchNBAStandings().catch(() => ({}) as Record<string, import("@/lib/espn").TeamRecord>), // don't fail if ESPN is down
    ]);

    const now = new Date();
    const upcoming = events.filter((e) => {
      const eventTime = e.dates.start.dateTime
        ? new Date(e.dates.start.dateTime)
        : new Date(e.dates.start.localDate);
      if (eventTime < now) return false;
      if (e.dates.status.code === "cancelled" || e.dates.status.code === "canceled") return false;
      const nameLower = e.name.toLowerCase();
      if (nameLower.includes("vip package") || nameLower.includes("parking")) return false;
      return true;
    });

    const seen = new Set<string>();
    const unique = upcoming.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    const mapped = unique.map((event) => {
      const venue = event._embedded?.venues?.[0];
      const venueState = venue?.state?.stateCode ?? "";
      let estDate: string;
      let estTime: string | null;
      let localTime: string | null = null;
      let tz: string | null = null;

      if (event.dates.start.dateTime) {
        const est = toEST(event.dates.start.dateTime);
        estDate = est.date;
        estTime = est.time;
        const local = toLocalTime(event.dates.start.dateTime, venueState);
        localTime = local.time;
        tz = local.tz;
      } else {
        estDate = event.dates.start.localDate;
        estTime = event.dates.start.localTime ?? null;
        localTime = estTime;
      }

      // Match Kalshi odds
      const matched = matchOddsToEvent(event.name, estDate, odds);

      // Determine team abbreviations for records
      // TM names are "Home vs Away" (home team listed first)
      let awayCode: string | null = matched?.away_team ?? null;
      let homeCode: string | null = matched?.home_team ?? null;
      if (!awayCode || !homeCode) {
        const parts = event.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
        if (parts.length >= 2) {
          homeCode = homeCode ?? findTeamCode(parts[0]);
          awayCode = awayCode ?? findTeamCode(parts[1]);
        }
      }

      const awayRec = awayCode ? standings[awayCode] : null;
      const homeRec = homeCode ? standings[homeCode] : null;

      return {
        id: event.id,
        name: event.name,
        url: event.url,
        est_date: estDate,
        est_time: estTime,
        local_time: localTime,
        tz: tz,
        venue: venue?.name ?? "Unknown Venue",
        city: venue?.city.name ?? "",
        state: venue?.state?.stateCode ?? "",
        lat: venue?.location ? parseFloat(venue.location.latitude) : null,
        lng: venue?.location ? parseFloat(venue.location.longitude) : null,
        min_price: cheapestPrice(event),
        status: event.dates.status.code,
        odds: matched
          ? {
              away_team: matched.away_team,
              home_team: matched.home_team,
              away_win: Math.round(matched.away_yes * 100),
              home_win: Math.round(matched.home_yes * 100),
              kalshi_event: matched.event_ticker,
            }
          : null,
        away_record: awayRec ? `${awayRec.wins}-${awayRec.losses}` : null,
        home_record: homeRec ? `${homeRec.wins}-${homeRec.losses}` : null,
        _awayCode: awayCode,
        _homeCode: homeCode,
        espn_price: null as { amount: number; available: number; url: string | null } | null,
        nearbyAirports: [] as AirportCoord[],
        nearbyTrainStations: [] as AirportCoord[],
        nearbyBusStations: [] as AirportCoord[],
      };
    });

    // Fetch ESPN ticket prices for all relevant dates
    const allDates = [...new Set(mapped.map((e) => e.est_date))];
    const espnTickets = await fetchEspnTickets(allDates).catch(() => ({}) as Record<string, import("@/lib/espn").EspnTicketInfo>);

    // Merge ESPN prices into mapped events
    for (const event of mapped) {
      if (event._awayCode && event._homeCode) {
        const key = `${event._awayCode}@${event._homeCode}`;
        const ticket = espnTickets[key];
        if (ticket) {
          event.espn_price = {
            amount: ticket.price,
            available: ticket.available,
            url: ticket.url,
          };
        }
      }
    }

    // Attach nearby stations (no travel times — enriched on demand)
    const venueMap = new Map<string, typeof mapped[number][]>();
    for (const event of mapped) {
      const key = event.venue;
      if (!venueMap.has(key)) venueMap.set(key, []);
      venueMap.get(key)!.push(event);
    }

    for (const [venueName, venueEvents] of venueMap.entries()) {
      const first = venueEvents[0];
      const entry = findStadiumEntry(venueName, first.city, first.state);
      if (!entry) continue;

      for (const ev of venueEvents) {
        ev.nearbyAirports = entry.airports;
        ev.nearbyTrainStations = entry.trainStations ?? [];
        ev.nearbyBusStations = entry.busStations ?? [];
        if (ev.lat == null) ev.lat = entry.lat;
        if (ev.lng == null) ev.lng = entry.lng;
      }
    }

    mapped.sort(
      (a, b) =>
        a.est_date.localeCompare(b.est_date) ||
        (a.est_time ?? "").localeCompare(b.est_time ?? "")
    );

    const grouped: Record<string, typeof mapped> = {};
    for (const event of mapped) {
      if (!grouped[event.est_date]) {
        grouped[event.est_date] = [];
      }
      grouped[event.est_date].push(event);
    }

    const dates = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, events]) => ({
        date,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        events: events.map(({ _awayCode, _homeCode, ...rest }) => rest),
      }));

    // Collect all unique airports from stadium data for nearest-airport lookup
    const seenAirports = new Set<string>();
    const allAirports: AirportCoord[] = [];
    for (const entry of Object.values(stadiumAirports)) {
      for (const apt of entry.airports) {
        if (!seenAirports.has(apt.code)) {
          seenAirports.add(apt.code);
          allAirports.push(apt);
        }
      }
    }

    return NextResponse.json({
      total: mapped.length,
      date_count: dates.length,
      dates,
      allAirports,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch NBA events:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch events",
      },
      { status: 500 }
    );
  }
}
