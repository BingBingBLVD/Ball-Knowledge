import { NextRequest, NextResponse } from "next/server";
import { getTravelTimes } from "@/lib/driving";

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
  walkMinutes: number;
  transitMinutes: number | null;
  transitFare: string | null;
  transitDirectionsUrl: string;
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const venueName = searchParams.get("venueName");
  const venueLat = parseFloat(searchParams.get("venueLat") ?? "");
  const venueLng = parseFloat(searchParams.get("venueLng") ?? "");
  const date = searchParams.get("date") ?? "";

  if (!venueName || isNaN(venueLat) || isNaN(venueLng) || !date) {
    return NextResponse.json({ hotels: [] });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ hotels: [] });

  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${venueLat},${venueLng}&radius=8000&type=lodging&key=${apiKey}&rankby=prominence`;
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ hotels: [] });
    const data = await res.json();
    if (data.status !== "OK" || !data.results) return NextResponse.json({ hotels: [] });

    const checkoutDate = new Date(date + "T12:00:00");
    checkoutDate.setDate(checkoutDate.getDate() + 1);
    const checkout = checkoutDate.toISOString().split("T")[0];

    const topPlaces = data.results.slice(0, 8).map((place: {
      name: string;
      vicinity: string;
      rating?: number;
      price_level?: number;
      geometry: { location: { lat: number; lng: number } };
    }) => {
      const hLat = place.geometry.location.lat;
      const hLng = place.geometry.location.lng;
      const dist = haversineMiles(hLat, hLng, venueLat, venueLng);
      return { place, hLat, hLng, dist };
    }).sort((a: { dist: number }, b: { dist: number }) => a.dist - b.dist).slice(0, 5);

    // Fetch real travel times (drive + transit) for each hotel in parallel
    const travelResults = await Promise.all(
      topPlaces.map((p: { hLat: number; hLng: number }) =>
        getTravelTimes(p.hLat, p.hLng, venueLat, venueLng).catch(() => null)
      )
    );

    const hotels: HotelSuggestion[] = topPlaces.map((entry: { place: { name: string; vicinity: string; rating?: number; price_level?: number }; hLat: number; hLng: number; dist: number }, i: number) => {
      const { place, hLat, hLng, dist } = entry;
      const times = travelResults[i];
      const roadMiles = dist * 1.3;
      const driveMin = times?.driveMinutes ?? Math.max(3, Math.round((roadMiles / 25) * 60));
      const walkMin = Math.max(1, Math.round(dist * 20));

      const uberEstimate = times?.uberEstimate ?? (() => {
        const low = Math.max(7, Math.round(2.5 + 1.5 * roadMiles + 0.25 * driveMin));
        const high = Math.round(low * 1.3);
        return low === high ? `~$${low}` : `~$${low}–${high}`;
      })();
      const lyftEstimate = times?.lyftEstimate ?? (() => {
        const low = Math.max(6, Math.round(2.0 + 1.35 * roadMiles + 0.20 * driveMin));
        const high = Math.round(low * 1.3);
        return low === high ? `~$${low}` : `~$${low}–${high}`;
      })();

      return {
        name: place.name,
        vicinity: place.vicinity,
        rating: place.rating ?? null,
        priceLevel: place.price_level ?? null,
        estimatedPrice: place.price_level ? PRICE_LEVEL_MAP[place.price_level] ?? "Unknown" : "Check price",
        bookingUrl: `https://www.google.com/travel/hotels/?q=hotels+near+${encodeURIComponent(venueName)}&dates=${date},${checkout}`,
        lat: hLat,
        lng: hLng,
        distanceMiles: Math.round(dist * 10) / 10,
        driveMinutes: driveMin,
        walkMinutes: walkMin,
        transitMinutes: times?.transitMinutes ?? null,
        transitFare: times?.transitFare ?? null,
        transitDirectionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${hLat},${hLng}&destination=${venueLat},${venueLng}&travelmode=transit`,
        uberEstimate: uberEstimate ?? `~$${Math.max(7, Math.round(2.5 + 1.5 * roadMiles))}`,
        lyftEstimate: lyftEstimate ?? `~$${Math.max(6, Math.round(2.0 + 1.35 * roadMiles))}`,
        directionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${hLat},${hLng}&destination=${venueLat},${venueLng}`,
      };
    });

    return NextResponse.json({ hotels });
  } catch {
    return NextResponse.json({ hotels: [] });
  }
}
