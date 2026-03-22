import { NextRequest, NextResponse } from "next/server";
import { searchRoutes, type Itinerary } from "@/lib/route-search";

interface RampageGame {
  venue: string;
  lat: number;
  lng: number;
  date: string;
  time: string;
  name?: string;
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
      legParams.push({
        from: { name: sorted[i].venue, lat: sorted[i].lat, lng: sorted[i].lng },
        to: { name: sorted[i + 1].venue, lat: sorted[i + 1].lat, lng: sorted[i + 1].lng },
        date: sorted[i + 1].date,
        time: sorted[i + 1].time || "19:00",
      });
    }

    // Last game → end
    const lastGame = sorted[sorted.length - 1];
    const dayAfterLast = new Date(lastGame.date + "T12:00:00");
    dayAfterLast.setDate(dayAfterLast.getDate() + 1);
    legParams.push({
      from: { name: lastGame.venue, lat: lastGame.lat, lng: lastGame.lng },
      to: { name: "End", lat: endLocation.lat, lng: endLocation.lng },
      date: dayAfterLast.toISOString().split("T")[0],
      time: "12:00",
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
          return {
            from: leg.from,
            to: leg.to,
            date: leg.date,
            itineraries: result.itineraries,
          };
        } catch (err) {
          console.error(`[rampage] Route search failed for ${leg.from.name} → ${leg.to.name}:`, err);
          return {
            from: leg.from,
            to: leg.to,
            date: leg.date,
            itineraries: [],
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

    // Summary: sum cheapest itinerary cost per leg
    let totalCost: number | null = 0;
    let totalMinutes = 0;
    for (const leg of legResults) {
      if (leg.itineraries.length > 0) {
        const cheapest = leg.itineraries.reduce((a, b) =>
          (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b
        );
        if (cheapest.totalCost != null && totalCost != null) {
          totalCost += cheapest.totalCost;
        } else {
          totalCost = null;
        }
        totalMinutes += cheapest.totalMinutes;
      }
    }

    return NextResponse.json({
      legs: legResults,
      hotels: hotelResults,
      games: sorted,
      summary: {
        totalCost,
        totalMinutes,
        gameCount: sorted.length,
      },
    });
  } catch (err) {
    console.error("[rampage] Error:", err);
    return NextResponse.json({ error: "Rampage planning failed" }, { status: 500 });
  }
}
