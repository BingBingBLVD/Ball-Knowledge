import { NextRequest, NextResponse } from "next/server";

// Cache: venueName -> { photos, ts }
const cache = new Map<string, { photos: string[]; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (Wikipedia images don't change often)

/** Fetch venue photo from Wikipedia/Wikimedia Commons (free, no API key) */
async function fetchWikipediaImage(venueName: string): Promise<string[]> {
  try {
    // Convert venue name to Wikipedia title format
    const wikiTitle = venueName.replace(/\s+/g, "_");
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(wikiTitle)}&prop=pageimages|images&format=json&pithumbsize=800&imlimit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return [];

    const photos: string[] = [];
    for (const page of Object.values(pages) as any[]) {
      // Main page thumbnail
      if (page.thumbnail?.source) {
        photos.push(page.thumbnail.source);
      }
      // Additional images from the article
      if (page.images) {
        const imageNames: string[] = page.images
          .map((img: { title: string }) => img.title)
          .filter((t: string) => /\.(jpg|jpeg|png|webp)$/i.test(t) && !t.includes("logo") && !t.includes("icon") && !t.includes("flag") && !t.includes("Commons") && !t.includes("Symbol"));

        // Fetch URLs for additional images (up to 4 more)
        for (const imgTitle of imageNames.slice(0, 4)) {
          try {
            const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(imgTitle)}&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json`;
            const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
            if (!imgRes.ok) continue;
            const imgData = await imgRes.json();
            const imgPages = imgData?.query?.pages;
            if (!imgPages) continue;
            for (const p of Object.values(imgPages) as any[]) {
              const thumbUrl = p.imageinfo?.[0]?.thumburl;
              if (thumbUrl && !photos.includes(thumbUrl)) {
                photos.push(thumbUrl);
              }
            }
          } catch { /* skip this image */ }
        }
      }
    }
    return photos.slice(0, 5);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const venueName = sp.get("venue") ?? "";

  if (!venueName) return NextResponse.json({ photos: [] });

  const cached = cache.get(venueName);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ photos: cached.photos });
  }

  const photos = await fetchWikipediaImage(venueName);
  cache.set(venueName, { photos, ts: Date.now() });
  return NextResponse.json({ photos });
}
