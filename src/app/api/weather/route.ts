import { NextRequest, NextResponse } from "next/server";

export interface HourlyWeather {
  time: string;       // ISO hour string e.g. "2026-03-25T19:00"
  temp: number;       // °F
  feelsLike: number;  // °F
  precip: number;     // mm
  precipProb: number; // %
  weatherCode: number;
  windSpeed: number;  // mph
  humidity: number;   // %
}

// WMO weather code -> label + emoji
const WMO_CODES: Record<number, string> = {
  0: "Clear",
  1: "Mostly Clear",
  2: "Partly Cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime Fog",
  51: "Light Drizzle",
  53: "Drizzle",
  55: "Heavy Drizzle",
  56: "Freezing Drizzle",
  57: "Freezing Drizzle",
  61: "Light Rain",
  63: "Rain",
  65: "Heavy Rain",
  66: "Freezing Rain",
  67: "Freezing Rain",
  71: "Light Snow",
  73: "Snow",
  75: "Heavy Snow",
  77: "Snow Grains",
  80: "Light Showers",
  81: "Showers",
  82: "Heavy Showers",
  85: "Snow Showers",
  86: "Heavy Snow Showers",
  95: "Thunderstorm",
  96: "Thunderstorm + Hail",
  99: "Thunderstorm + Hail",
};

export function weatherLabel(code: number): string {
  return WMO_CODES[code] ?? "Unknown";
}

// Simple in-memory cache
const cache = new Map<string, { data: HourlyWeather[]; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") ?? "");
  const lng = parseFloat(sp.get("lng") ?? "");
  const date = sp.get("date") ?? ""; // YYYY-MM-DD

  if (isNaN(lat) || isNaN(lng) || !date) {
    return NextResponse.json({ error: "Missing lat, lng, or date" }, { status: 400 });
  }

  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${date}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ hours: cached.data });
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=mm&timezone=auto&start_date=${date}&end_date=${date}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return NextResponse.json({ hours: [] });
    const data = await res.json();
    const h = data.hourly;
    if (!h?.time) return NextResponse.json({ hours: [] });

    const hours: HourlyWeather[] = (h.time as string[]).map((t: string, i: number) => ({
      time: t,
      temp: Math.round(h.temperature_2m[i]),
      feelsLike: Math.round(h.apparent_temperature[i]),
      precip: h.precipitation[i],
      precipProb: h.precipitation_probability[i],
      weatherCode: h.weather_code[i],
      windSpeed: Math.round(h.wind_speed_10m[i]),
      humidity: h.relative_humidity_2m[i],
    }));

    cache.set(key, { data: hours, ts: Date.now() });
    return NextResponse.json({ hours });
  } catch {
    return NextResponse.json({ hours: [] });
  }
}
