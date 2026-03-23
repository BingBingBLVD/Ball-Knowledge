import { NextRequest, NextResponse } from "next/server";

export interface ParkingSpot {
  name: string;
  vicinity: string;
  lat: number;
  lng: number;
  distanceMiles: number;
  walkMinutes: number;
  rating: number | null;
  totalRatings: number;
  openNow: boolean | null;
  priceLevel: string | null;
  estimatedPrice: string | null;
  photoUrl: string | null;
  spotHeroUrl: string;
  directionsUrl: string;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Cache: "lat,lng" -> { data, ts }
const cache = new Map<string, { data: ParkingSpot[]; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const venueLat = parseFloat(sp.get("venueLat") ?? "");
  const venueLng = parseFloat(sp.get("venueLng") ?? "");
  const venueName = sp.get("venueName") ?? "";
  const date = sp.get("date") ?? "";

  if (isNaN(venueLat) || isNaN(venueLng)) {
    return NextResponse.json({ parking: [] });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ parking: [] });

  const key = `${venueLat.toFixed(3)},${venueLng.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ parking: cached.data });
  }

  try {
    // Search for parking near venue — 2km radius
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${venueLat},${venueLng}&radius=2000&type=parking&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ parking: [] });
    const data = await res.json();
    if (data.status !== "OK" || !data.results) return NextResponse.json({ parking: [] });

    // SpotHero search URL for venue area
    const spotHeroBase = `https://spothero.com/search?latitude=${venueLat}&longitude=${venueLng}${date ? `&starts=${date}T16:00&ends=${date}T23:59` : ""}`;

    const PRICE_MAP: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };

    const spots: ParkingSpot[] = data.results
      .slice(0, 15)
      .map((place: {
        name: string;
        vicinity: string;
        rating?: number;
        user_ratings_total?: number;
        price_level?: number;
        photos?: { photo_reference: string }[];
        opening_hours?: { open_now?: boolean };
        geometry: { location: { lat: number; lng: number } };
      }) => {
        const pLat = place.geometry.location.lat;
        const pLng = place.geometry.location.lng;
        const dist = haversineMiles(pLat, pLng, venueLat, venueLng);
        const walkMin = Math.max(1, Math.round(dist * 20));
        // Estimate event parking price based on distance (closer = pricier)
        const isFree = place.name.toLowerCase().includes("free") || place.price_level === 0;
        let estimatedPrice: string | null = null;
        if (isFree) {
          estimatedPrice = "Free";
        } else if (dist < 0.3) {
          estimatedPrice = "$25–45";
        } else if (dist < 0.6) {
          estimatedPrice = "$15–30";
        } else if (dist < 1) {
          estimatedPrice = "$10–20";
        } else {
          estimatedPrice = "$5–15";
        }

        const photoRef = place.photos?.[0]?.photo_reference;
        const photoUrl = photoRef ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${apiKey}` : null;

        return {
          name: place.name,
          vicinity: place.vicinity || "",
          lat: pLat,
          lng: pLng,
          distanceMiles: Math.round(dist * 100) / 100,
          walkMinutes: walkMin,
          rating: place.rating ?? null,
          totalRatings: place.user_ratings_total ?? 0,
          openNow: place.opening_hours?.open_now ?? null,
          priceLevel: place.price_level != null ? PRICE_MAP[place.price_level] ?? null : null,
          estimatedPrice,
          photoUrl,
          spotHeroUrl: spotHeroBase,
          directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${pLat},${pLng}&travelmode=driving`,
        };
      })
      .sort((a: ParkingSpot, b: ParkingSpot) => a.distanceMiles - b.distanceMiles)
      .slice(0, 8);

    cache.set(key, { data: spots, ts: Date.now() });
    return NextResponse.json({ parking: spots });
  } catch {
    return NextResponse.json({ parking: [] });
  }
}
