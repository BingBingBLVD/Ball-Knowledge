import { NextRequest, NextResponse } from "next/server";

export interface RestaurantSpot {
  name: string;
  vicinity: string;
  lat: number;
  lng: number;
  distanceMiles: number;
  walkMinutes: number;
  rating: number | null;
  totalRatings: number;
  priceLevel: string | null;
  photoUrl: string | null;
  yelpUrl: string;
  directionsUrl: string;
  category: "pregame" | "postgame";
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const cache = new Map<string, { data: RestaurantSpot[]; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

const PRICE_MAP: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };

function mapPlaces(
  results: Array<{
    name: string;
    vicinity: string;
    rating?: number;
    user_ratings_total?: number;
    price_level?: number;
    photos?: { photo_reference: string }[];
    geometry: { location: { lat: number; lng: number } };
  }>,
  venueLat: number,
  venueLng: number,
  venueName: string,
  apiKey: string,
  category: "pregame" | "postgame",
): RestaurantSpot[] {
  return results.map((place) => {
    const pLat = place.geometry.location.lat;
    const pLng = place.geometry.location.lng;
    const dist = haversineMiles(pLat, pLng, venueLat, venueLng);
    const walkMin = Math.max(1, Math.round(dist * 20));
    const photoRef = place.photos?.[0]?.photo_reference;
    const photoUrl = photoRef ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${apiKey}` : null;
    const yelpSearch = encodeURIComponent(place.name + " " + place.vicinity);

    return {
      name: place.name,
      vicinity: place.vicinity || "",
      lat: pLat,
      lng: pLng,
      distanceMiles: Math.round(dist * 100) / 100,
      walkMinutes: walkMin,
      rating: place.rating ?? null,
      totalRatings: place.user_ratings_total ?? 0,
      priceLevel: place.price_level != null ? PRICE_MAP[place.price_level] ?? null : null,
      photoUrl,
      yelpUrl: `https://www.yelp.com/search?find_desc=${yelpSearch}`,
      directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${pLat},${pLng}&travelmode=walking`,
      category,
    };
  });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const venueLat = parseFloat(sp.get("venueLat") ?? "");
  const venueLng = parseFloat(sp.get("venueLng") ?? "");
  const venueName = sp.get("venueName") ?? "";

  if (isNaN(venueLat) || isNaN(venueLng)) {
    return NextResponse.json({ restaurants: [] });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ restaurants: [] });

  const key = `${venueLat.toFixed(3)},${venueLng.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ restaurants: cached.data });
  }

  try {
    // Two searches: restaurants for sit-down spots, bars/pubs for pregame vibes
    const [restaurantRes, barRes] = await Promise.all([
      fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${venueLat},${venueLng}&radius=1500&type=restaurant&key=${apiKey}&rankby=prominence`),
      fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${venueLat},${venueLng}&radius=1500&type=bar&key=${apiKey}&rankby=prominence`),
    ]);

    const restaurantData = restaurantRes.ok ? await restaurantRes.json() : { results: [] };
    const barData = barRes.ok ? await barRes.json() : { results: [] };

    const restaurantResults = (restaurantData.status === "OK" ? restaurantData.results : []).slice(0, 12);
    const barResults = (barData.status === "OK" ? barData.results : []).slice(0, 8);

    // Dedupe by place name (bars can overlap with restaurants)
    const seenNames = new Set<string>();
    const allResults: RestaurantSpot[] = [];

    // Bars/pubs → pregame
    for (const spot of mapPlaces(barResults, venueLat, venueLng, venueName, apiKey, "pregame")) {
      if (!seenNames.has(spot.name.toLowerCase())) {
        seenNames.add(spot.name.toLowerCase());
        allResults.push(spot);
      }
    }

    // Restaurants → postgame (sit-down dinner after the game)
    for (const spot of mapPlaces(restaurantResults, venueLat, venueLng, venueName, apiKey, "postgame")) {
      if (!seenNames.has(spot.name.toLowerCase())) {
        seenNames.add(spot.name.toLowerCase());
        allResults.push(spot);
      }
    }

    // Filter to well-rated spots (3.5+ stars with meaningful reviews)
    const quality = allResults
      .filter((r) => (r.rating ?? 0) >= 3.5 && r.totalRatings >= 20)
      .sort((a, b) => {
        // Sort by weighted score: rating * log(totalRatings)
        const scoreA = (a.rating ?? 0) * Math.log10(a.totalRatings + 1);
        const scoreB = (b.rating ?? 0) * Math.log10(b.totalRatings + 1);
        return scoreB - scoreA;
      });

    // Take top pregame and postgame spots
    const pregame = quality.filter((r) => r.category === "pregame").slice(0, 6);
    const postgame = quality.filter((r) => r.category === "postgame").slice(0, 6);
    const restaurants = [...pregame, ...postgame];

    cache.set(key, { data: restaurants, ts: Date.now() });
    return NextResponse.json({ restaurants });
  } catch {
    return NextResponse.json({ restaurants: [] });
  }
}
