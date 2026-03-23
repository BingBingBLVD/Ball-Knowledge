import { NextRequest, NextResponse } from "next/server";

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

    const hotels: HotelSuggestion[] = data.results.slice(0, 8).map((place: {
      name: string;
      vicinity: string;
      rating?: number;
      price_level?: number;
      geometry: { location: { lat: number; lng: number } };
    }) => {
      const hLat = place.geometry.location.lat;
      const hLng = place.geometry.location.lng;
      const dist = haversineMiles(hLat, hLng, venueLat, venueLng);
      const roadMiles = dist * 1.3;
      const driveMin = Math.max(3, Math.round((roadMiles / 25) * 60));
      const uberLow = Math.max(7, Math.round(2.5 + 1.5 * roadMiles + 0.25 * driveMin));
      const uberHigh = Math.round(uberLow * 1.3);
      const lyftLow = Math.max(6, Math.round(2.0 + 1.35 * roadMiles + 0.20 * driveMin));
      const lyftHigh = Math.round(lyftLow * 1.3);

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
        uberEstimate: uberLow === uberHigh ? `~$${uberLow}` : `~$${uberLow}–${uberHigh}`,
        lyftEstimate: lyftLow === lyftHigh ? `~$${lyftLow}` : `~$${lyftLow}–${lyftHigh}`,
        directionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${hLat},${hLng}&destination=${venueLat},${venueLng}`,
      };
    }).sort((a: HotelSuggestion, b: HotelSuggestion) => a.distanceMiles - b.distanceMiles).slice(0, 5);

    return NextResponse.json({ hotels });
  } catch {
    return NextResponse.json({ hotels: [] });
  }
}
