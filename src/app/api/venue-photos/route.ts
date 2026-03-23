import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// Cache: venueName -> { photos, ts }
const cache = new Map<string, { photos: string[]; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const venueName = sp.get("venue") ?? "";
  const lat = sp.get("lat") ?? "";
  const lng = sp.get("lng") ?? "";

  if (!venueName || !API_KEY) return NextResponse.json({ photos: [] });

  const key = venueName;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ photos: cached.photos });
  }

  try {
    // Find the place first
    const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(venueName)}&inputtype=textquery&fields=place_id,photos&locationbias=point:${lat},${lng}&key=${API_KEY}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return NextResponse.json({ photos: [] });
    const searchData = await searchRes.json();

    const candidate = searchData.candidates?.[0];
    if (!candidate?.photos?.length) {
      // Fallback: try nearby search
      const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=500&keyword=${encodeURIComponent(venueName)}&key=${API_KEY}`;
      const nearbyRes = await fetch(nearbyUrl);
      if (!nearbyRes.ok) return NextResponse.json({ photos: [] });
      const nearbyData = await nearbyRes.json();
      const place = nearbyData.results?.[0];
      if (!place?.photos?.length) return NextResponse.json({ photos: [] });

      const photos = place.photos.slice(0, 5).map((p: { photo_reference: string }) =>
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${p.photo_reference}&key=${API_KEY}`
      );
      cache.set(key, { photos, ts: Date.now() });
      return NextResponse.json({ photos });
    }

    // Get up to 5 photos
    const photoRefs = candidate.photos.slice(0, 5);

    // If we need more photos, get place details
    let allRefs = photoRefs;
    if (photoRefs.length < 5 && candidate.place_id) {
      const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${candidate.place_id}&fields=photos&key=${API_KEY}`;
      const detailRes = await fetch(detailUrl);
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        allRefs = (detailData.result?.photos ?? photoRefs).slice(0, 5);
      }
    }

    const photos = allRefs.map((p: { photo_reference: string }) =>
      `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${p.photo_reference}&key=${API_KEY}`
    );

    cache.set(key, { photos, ts: Date.now() });
    return NextResponse.json({ photos });
  } catch {
    return NextResponse.json({ photos: [] });
  }
}
