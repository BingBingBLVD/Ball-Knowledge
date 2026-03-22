import { NextRequest, NextResponse } from "next/server";
import { searchRoutes, type Itinerary, type Leg } from "@/lib/route-search";

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

interface RampageLeg {
  from: { name: string; lat: number; lng: number };
  to: { name: string; lat: number; lng: number };
  date: string;
  itineraries: Itinerary[];
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
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) return [];

  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${venueLat},${venueLng}&radius=8000&type=lodging&key=${apiKey}&rankby=prominence`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.status !== "OK" || !data.results) return [];

    const checkoutDate = new Date(checkinDate + "T12:00:00");
    checkoutDate.setDate(checkoutDate.getDate() + 1);
    const checkout = checkoutDate.toISOString().split("T")[0];

    return data.results.slice(0, 5).map((place: {
      name: string;
      vicinity: string;
      rating?: number;
      price_level?: number;
      geometry: { location: { lat: number; lng: number } };
    }) => ({
      name: place.name,
      vicinity: place.vicinity,
      rating: place.rating ?? null,
      priceLevel: place.price_level ?? null,
      estimatedPrice: place.price_level ? PRICE_LEVEL_MAP[place.price_level] ?? "Unknown" : "Check price",
      bookingUrl: `https://www.google.com/travel/hotels/?q=hotels+near+${encodeURIComponent(venueName)}&dates=${checkinDate},${checkout}`,
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
    }));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { startLocation, endLocation, games } = body as {
      startLocation: { lat: number; lng: number };
      endLocation: { lat: number; lng: number };
      games: RampageGame[];
    };

    if (!startLocation || !endLocation || !games || games.length < 2) {
      return NextResponse.json({ error: "Need start, end, and at least 2 games" }, { status: 400 });
    }

    // Sort games chronologically
    const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));

    // Build legs: start → game1, game1 → game2, ..., gameN → end
    const legParams: { from: { name: string; lat: number; lng: number }; to: { name: string; lat: number; lng: number }; date: string; time: string }[] = [];

    // Start → first game
    legParams.push({
      from: { name: "Start", lat: startLocation.lat, lng: startLocation.lng },
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
      to: { name: "End", lat: endLocation.lat, lng: endLocation.lng },
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
        gameCount: sorted.length,
      },
    });
  } catch (err) {
    console.error("[rampage] Error:", err);
    return NextResponse.json({ error: "Rampage planning failed" }, { status: 500 });
  }
}
