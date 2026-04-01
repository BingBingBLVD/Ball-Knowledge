import { NextRequest, NextResponse } from "next/server";
import { searchRoutes, type Itinerary, type Leg } from "@/lib/route-search";
import { getTravelTimes } from "@/lib/driving";

interface RampageGame {
  venue: string;
  lat: number;
  lng: number;
  date: string;
  time: string;
  name?: string;
  min_price?: { amount: number; currency: string } | null;
  espn_price?: { amount: number } | null;
}

interface TransitOption {
  transitMinutes: number;
  transitFare: string | null;
  transitDepartureTime: string | null;
  transitArrivalTime: string | null;
  uberEstimate: string | null;
  lyftEstimate: string | null;
  googleMapsUrl: string;
}

interface RampageLeg {
  from: { name: string; lat: number; lng: number };
  to: { name: string; lat: number; lng: number };
  date: string;
  itineraries: Itinerary[];
  transitOption?: TransitOption | null;
  googleFlightsUrl?: string;
  originAirportCode?: string;
  destAirportCode?: string;
}

interface HotelSuggestion {
  name: string;
  vicinity: string;
  rating: number | null;
  priceLevel: number | null;
  estimatedPrice: string;
  bookingUrl: string;
  lat: number;
  lng: number;
  distanceMiles: number;
  driveMinutes: number;
  uberEstimate: string;
  lyftEstimate: string;
  directionsUrl: string;
}

const PRICE_LEVEL_MAP: Record<number, string> = {
  1: "$50-80/night",
  2: "$80-150/night",
  3: "$150-250/night",
  4: "$250+/night",
};

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Generate a simple drive-only itinerary as fallback */
function driveFallback(
  from: { name: string; lat: number; lng: number },
  to: { name: string; lat: number; lng: number },
  date: string,
): Itinerary {
  const miles = haversineMiles(from.lat, from.lng, to.lat, to.lng);
  const roadMiles = Math.round(miles * 1.3);
  const driveMin = Math.max(5, Math.round((miles * 1.3 * 60) / 50));
  const gmapsLink = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;

  return {
    id: "drive-fallback",
    totalMinutes: driveMin,
    totalCost: null,
    departureTime: `${date}T12:00:00.000Z`,
    arrivalTime: `${date}T12:00:00.000Z`,
    bufferMinutes: 0,
    legs: [{
      mode: "drive" as const,
      from: from.name,
      fromLat: from.lat,
      fromLng: from.lng,
      to: to.name,
      toLat: to.lat,
      toLng: to.lng,
      depart: `${date}T12:00:00.000Z`,
      arrive: `${date}T12:00:00.000Z`,
      minutes: driveMin,
      cost: null,
      bookingUrl: gmapsLink,
      miles: roadMiles,
      enrichable: true,
    }],
  };
}

async function searchHotelsNearVenue(
  venueLat: number,
  venueLng: number,
  venueName: string,
  checkinDate: string,
): Promise<HotelSuggestion[]> {
  try {
    // Use Overpass API instead of Google Places
    const query = `[out:json][timeout:10];(node["tourism"="hotel"](around:8000,${venueLat},${venueLng});way["tourism"="hotel"](around:8000,${venueLat},${venueLng});node["tourism"="motel"](around:8000,${venueLat},${venueLng});way["tourism"="motel"](around:8000,${venueLat},${venueLng}););out center body 15;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.elements) return [];

    const checkoutDate = new Date(checkinDate + "T12:00:00");
    checkoutDate.setDate(checkoutDate.getDate() + 1);
    const checkout = checkoutDate.toISOString().split("T")[0];

    return data.elements
      .map((el: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }) => {
        const hLat = el.lat ?? el.center?.lat;
        const hLng = el.lon ?? el.center?.lon;
        if (hLat == null || hLng == null) return null;
        const tags = el.tags ?? {};
        if (!tags.name) return null;
        const dist = haversineMiles(hLat, hLng, venueLat, venueLng);
        const roadMiles = dist * 1.3;
        const driveMin = Math.max(3, Math.round((roadMiles / 25) * 60));
        const uberLow = Math.max(7, Math.round(2.5 + 1.5 * roadMiles + 0.25 * driveMin));
        const uberHigh = Math.round(uberLow * 1.3);
        const lyftLow = Math.max(6, Math.round(2.0 + 1.35 * roadMiles + 0.20 * driveMin));
        const lyftHigh = Math.round(lyftLow * 1.3);
        const stars = parseInt(tags.stars ?? "0");

        return {
          name: tags.name,
          vicinity: tags["addr:street"] ? `${tags["addr:housenumber"] ?? ""} ${tags["addr:street"]}`.trim() : "",
          rating: null,
          priceLevel: stars > 0 ? stars : null,
          estimatedPrice: stars >= 4 ? "$150-250/night" : stars >= 3 ? "$80-150/night" : stars >= 2 ? "$50-80/night" : "Check price",
          bookingUrl: `https://www.google.com/travel/hotels/?q=hotels+near+${encodeURIComponent(venueName)}&dates=${checkinDate},${checkout}`,
          lat: hLat,
          lng: hLng,
          distanceMiles: Math.round(dist * 10) / 10,
          driveMinutes: driveMin,
          uberEstimate: uberLow === uberHigh ? `~$${uberLow}` : `~$${uberLow}–${uberHigh}`,
          lyftEstimate: lyftLow === lyftHigh ? `~$${lyftLow}` : `~$${lyftLow}–${lyftHigh}`,
          directionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${hLat},${hLng}&destination=${venueLat},${venueLng}`,
        };
      })
      .filter(Boolean)
      .sort((a: HotelSuggestion, b: HotelSuggestion) => a.distanceMiles - b.distanceMiles)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { startLocation, endLocation, games } = body as {
      startLocation: { lat: number; lng: number; label?: string };
      endLocation: { lat: number; lng: number; label?: string };
      games: RampageGame[];
    };

    if (!startLocation || !endLocation || !games || games.length < 1) {
      return NextResponse.json({ error: "Need start, end, and at least 1 game" }, { status: 400 });
    }

    // Sort games chronologically
    const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));

    // Build legs: start → game1, game1 → game2, ..., gameN → end
    const legParams: { from: { name: string; lat: number; lng: number }; to: { name: string; lat: number; lng: number }; date: string; time: string }[] = [];

    // Start → first game
    legParams.push({
      from: { name: startLocation.label || "Start", lat: startLocation.lat, lng: startLocation.lng },
      to: { name: sorted[0].venue, lat: sorted[0].lat, lng: sorted[0].lng },
      date: sorted[0].date,
      time: sorted[0].time || "19:00",
    });

    // Between games
    for (let i = 0; i < sorted.length - 1; i++) {
      // For inter-stadium legs, use the day AFTER the current game (travel the next morning)
      const travelDate = sorted[i + 1].date;
      legParams.push({
        from: { name: sorted[i].venue, lat: sorted[i].lat, lng: sorted[i].lng },
        to: { name: sorted[i + 1].venue, lat: sorted[i + 1].lat, lng: sorted[i + 1].lng },
        date: travelDate,
        time: sorted[i + 1].time || "19:00",
      });
    }

    // Last game → end
    const lastGame = sorted[sorted.length - 1];
    const dayAfterLast = new Date(lastGame.date + "T12:00:00");
    dayAfterLast.setDate(dayAfterLast.getDate() + 1);
    const returnDate = dayAfterLast.toISOString().split("T")[0];
    legParams.push({
      from: { name: lastGame.venue, lat: lastGame.lat, lng: lastGame.lng },
      to: { name: endLocation.label || "End", lat: endLocation.lat, lng: endLocation.lng },
      date: returnDate,
      time: "18:00",
    });

    // Search routes for all legs in parallel
    const legResults = await Promise.all(
      legParams.map(async (leg): Promise<RampageLeg> => {
        try {
          const result = await searchRoutes({
            originLat: leg.from.lat,
            originLng: leg.from.lng,
            venueName: leg.to.name,
            venueLat: leg.to.lat,
            venueLng: leg.to.lng,
            gameDate: leg.date,
            gameTime: leg.time,
            limit: 5,
          });

          // If searchRoutes returns nothing (past dates, etc), add a drive fallback
          const itineraries = result.itineraries.length > 0
            ? result.itineraries
            : [driveFallback(leg.from, leg.to, leg.date)];

          return {
            from: leg.from,
            to: leg.to,
            date: leg.date,
            itineraries,
            googleFlightsUrl: result.googleFlightsUrl,
            originAirportCode: result.originAirportCode,
            destAirportCode: result.destAirportCode,
          };
        } catch (err) {
          console.error(`[rampage] Route search failed for ${leg.from.name} → ${leg.to.name}:`, err);
          return {
            from: leg.from,
            to: leg.to,
            date: leg.date,
            itineraries: [driveFallback(leg.from, leg.to, leg.date)],
          };
        }
      })
    );

    // Enrich each leg with transit options (Google Directions) in parallel
    await Promise.all(
      legResults.map(async (leg) => {
        try {
          const times = await getTravelTimes(
            leg.from.lat, leg.from.lng,
            leg.to.lat, leg.to.lng,
          );
          if (times.transitMinutes != null) {
            leg.transitOption = {
              transitMinutes: times.transitMinutes,
              transitFare: times.transitFare,
              transitDepartureTime: times.transitDepartureTime,
              transitArrivalTime: times.transitArrivalTime,
              uberEstimate: times.uberEstimate,
              lyftEstimate: times.lyftEstimate,
              googleMapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${leg.from.lat},${leg.from.lng}&destination=${leg.to.lat},${leg.to.lng}&travelmode=transit`,
            };
          }
        } catch {
          // Transit enrichment is best-effort
        }
      })
    );

    // Search hotels for each game stop in parallel
    const hotelResults = await Promise.all(
      sorted.map(async (game) => {
        const suggestions = await searchHotelsNearVenue(game.lat, game.lng, game.venue, game.date);
        return {
          date: game.date,
          venue: game.venue,
          suggestions,
        };
      })
    );

    // Summary: sum cheapest transport cost + ticket costs
    let transportCost: number | null = 0;
    let totalMinutes = 0;
    let minMinutes = 0;
    let maxMinutes = 0;
    let ticketCost = 0;

    for (const leg of legResults) {
      if (leg.itineraries.length > 0) {
        const cheapest = leg.itineraries.reduce((a, b) =>
          (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b
        );
        if (cheapest.totalCost != null && transportCost != null) {
          transportCost += cheapest.totalCost;
        } else {
          transportCost = null;
        }
        totalMinutes += cheapest.totalMinutes;
        const times = leg.itineraries.map((i) => i.totalMinutes);
        minMinutes += Math.min(...times);
        maxMinutes += Math.max(...times);
      }
    }

    // Sum ticket prices from games
    for (const game of sorted) {
      const price = game.espn_price?.amount ?? game.min_price?.amount;
      if (price) ticketCost += price;
    }

    return NextResponse.json({
      legs: legResults,
      hotels: hotelResults,
      games: sorted,
      summary: {
        transportCost,
        ticketCost,
        totalCost: transportCost != null ? transportCost + ticketCost : null,
        totalMinutes,
        minMinutes,
        maxMinutes,
        gameCount: sorted.length,
      },
    });
  } catch (err) {
    console.error("[rampage] Error:", err);
    return NextResponse.json({ error: "Rampage planning failed" }, { status: 500 });
  }
}
