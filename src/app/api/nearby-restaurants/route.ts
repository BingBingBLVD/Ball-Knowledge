import { NextRequest, NextResponse } from "next/server";
import { queryOverpass } from "@/lib/overpass";

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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const venueLat = parseFloat(sp.get("venueLat") ?? "");
  const venueLng = parseFloat(sp.get("venueLng") ?? "");
  const venueName = sp.get("venueName") ?? "";

  if (isNaN(venueLat) || isNaN(venueLng)) {
    return NextResponse.json({ restaurants: [] });
  }

  const key = `${venueLat.toFixed(3)},${venueLng.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ restaurants: cached.data });
  }

  try {
    // Query Overpass for restaurants and bars/pubs within 1.5km (with retry across mirrors)
    const query = `[out:json][timeout:10];(node["amenity"="restaurant"](around:1500,${venueLat},${venueLng});node["amenity"="bar"](around:1500,${venueLat},${venueLng});node["amenity"="pub"](around:1500,${venueLat},${venueLng}););out body 30;`;
    const data = await queryOverpass(query);

    const seenNames = new Set<string>();
    const allResults: RestaurantSpot[] = [];

    for (const el of data.elements) {
      const tags = el.tags ?? {};
      const name = tags.name;
      if (!name || seenNames.has(name.toLowerCase())) continue;
      seenNames.add(name.toLowerCase());

      const pLat = el.lat;
      const pLng = el.lon;
      if (pLat == null || pLng == null) continue;

      const dist = haversineMiles(pLat, pLng, venueLat, venueLng);
      const walkMin = Math.max(1, Math.round(dist * 20));
      const amenity = tags.amenity;
      const category: "pregame" | "postgame" = (amenity === "bar" || amenity === "pub") ? "pregame" : "postgame";
      const yelpSearch = encodeURIComponent(name + " " + (tags["addr:city"] ?? ""));

      allResults.push({
        name,
        vicinity: tags["addr:street"] ? `${tags["addr:housenumber"] ?? ""} ${tags["addr:street"]}`.trim() : "",
        lat: pLat,
        lng: pLng,
        distanceMiles: Math.round(dist * 100) / 100,
        walkMinutes: walkMin,
        rating: null,
        totalRatings: 0,
        priceLevel: null,
        photoUrl: null,
        yelpUrl: `https://www.yelp.com/search?find_desc=${yelpSearch}`,
        directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${pLat},${pLng}&travelmode=walking`,
        category,
      });
    }

    // Sort by distance
    allResults.sort((a, b) => a.distanceMiles - b.distanceMiles);

    const pregame = allResults.filter((r) => r.category === "pregame").slice(0, 6);
    const postgame = allResults.filter((r) => r.category === "postgame").slice(0, 6);
    const restaurants = [...pregame, ...postgame];

    cache.set(key, { data: restaurants, ts: Date.now() });
    return NextResponse.json({ restaurants });
  } catch {
    return NextResponse.json({ restaurants: [] });
  }
}
