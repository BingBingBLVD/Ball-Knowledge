import { NextRequest, NextResponse } from "next/server";
import { getTravelTimes } from "@/lib/driving";

interface HotelSuggestion {
  name: string;
  vicinity: string;
  rating: number | null;
  priceLevel: number | null;
  estimatedPrice: string;
  bookingUrl: string;
  photoUrl: string | null;
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

  try {
    // Query Overpass API for hotels/lodging within 8km
    const query = `[out:json][timeout:10];(node["tourism"="hotel"](around:8000,${venueLat},${venueLng});way["tourism"="hotel"](around:8000,${venueLat},${venueLng});node["tourism"="motel"](around:8000,${venueLat},${venueLng});way["tourism"="motel"](around:8000,${venueLat},${venueLng}););out center body 20;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return NextResponse.json({ hotels: [] });
    const data = await res.json();
    if (!data.elements) return NextResponse.json({ hotels: [] });

    const checkoutDate = new Date(date + "T12:00:00");
    checkoutDate.setDate(checkoutDate.getDate() + 1);
    const checkout = checkoutDate.toISOString().split("T")[0];

    // Parse and sort by distance
    const topPlaces = data.elements
      .map((el: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }) => {
        const hLat = el.lat ?? el.center?.lat;
        const hLng = el.lon ?? el.center?.lon;
        if (hLat == null || hLng == null) return null;
        const tags = el.tags ?? {};
        if (!tags.name) return null;
        const dist = haversineMiles(hLat, hLng, venueLat, venueLng);
        return { tags, hLat, hLng, dist };
      })
      .filter(Boolean)
      .sort((a: { dist: number }, b: { dist: number }) => a.dist - b.dist)
      .slice(0, 5);

    // Fetch real travel times for each hotel in parallel
    const travelResults = await Promise.all(
      topPlaces.map((p: { hLat: number; hLng: number }) =>
        getTravelTimes(p.hLat, p.hLng, venueLat, venueLng).catch(() => null)
      )
    );

    const hotels: HotelSuggestion[] = topPlaces.map((entry: { tags: Record<string, string>; hLat: number; hLng: number; dist: number }, i: number) => {
      const { tags, hLat, hLng, dist } = entry;
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

      // Estimate price from OSM stars tag if available
      const stars = parseInt(tags.stars ?? "0");
      let estimatedPrice = "—";
      if (stars >= 4) estimatedPrice = "$150–250/night";
      else if (stars >= 3) estimatedPrice = "$80–150/night";
      else if (stars >= 2) estimatedPrice = "$50–80/night";

      return {
        name: tags.name,
        vicinity: tags["addr:street"] ? `${tags["addr:housenumber"] ?? ""} ${tags["addr:street"]}`.trim() : "",
        rating: null,
        priceLevel: stars > 0 ? stars : null,
        estimatedPrice,
        bookingUrl: `https://www.google.com/travel/hotels/?q=hotels+near+${encodeURIComponent(venueName)}&dates=${date},${checkout}`,
        photoUrl: null,
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
