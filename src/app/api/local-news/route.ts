import { NextRequest, NextResponse } from "next/server";

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  published: string; // ISO date string
  snippet: string;
}

// Cache: "lat,lng" -> { data, ts }
const cache = new Map<string, { data: NewsItem[]; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const city = sp.get("city") ?? "";
  const state = sp.get("state") ?? "";
  const venue = sp.get("venue") ?? "";

  if (!city) {
    return NextResponse.json({ news: [] });
  }

  const key = `${city},${state},${venue}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ news: cached.data });
  }

  try {
    // Use Google News RSS — free, no key needed
    const query = encodeURIComponent(`${venue || ""} ${city} ${state} sports`.trim());
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(rssUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return NextResponse.json({ news: [] });

    const xml = await res.text();
    const news = parseRss(xml).slice(0, 8);

    cache.set(key, { data: news, ts: Date.now() });
    return NextResponse.json({ news });
  } catch {
    return NextResponse.json({ news: [] });
  }
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    const source = extractTag(itemXml, "source");
    const description = extractTag(itemXml, "description");

    if (!title || !link) continue;

    // Clean HTML from description
    const snippet = description
      ? description.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, 200)
      : "";

    items.push({
      title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
      link,
      source: source || "Google News",
      published: pubDate ? new Date(pubDate).toISOString() : "",
      snippet,
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  // Handle CDATA
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`);
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const match = regex.exec(xml);
  return match ? match[1].trim() : "";
}
