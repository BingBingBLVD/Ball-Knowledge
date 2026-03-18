const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";

interface TravelTimes {
  driveMinutes: number;
  transitMinutes: number | null;
}

// In-memory cache: "lat1,lng1;lat2,lng2" -> TravelTimes
const cache = new Map<string, TravelTimes>();

function cacheKey(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): string {
  return `${fromLat.toFixed(4)},${fromLng.toFixed(4)};${toLat.toFixed(4)},${toLng.toFixed(4)}`;
}

/** Haversine distance in km */
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Fallback estimate from straight-line distance */
function estimateDriveMinutes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): number {
  const km = haversineKm(fromLat, fromLng, toLat, toLng);
  return Math.round((km * 1.4) / 50 * 60);
}

async function fetchGoogleDirections(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  mode: "driving" | "transit"
): Promise<number | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&mode=${mode}&key=${GOOGLE_API_KEY}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const seconds = data?.routes?.[0]?.legs?.[0]?.duration?.value;
    if (seconds == null) return null;
    return Math.round(seconds / 60);
  } catch {
    return null;
  }
}

export async function getTravelTimes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<TravelTimes> {
  const key = cacheKey(fromLat, fromLng, toLat, toLng);
  const cached = cache.get(key);
  if (cached) return cached;

  // Fetch driving and transit in parallel
  const [drive, transit] = await Promise.all([
    fetchGoogleDirections(fromLat, fromLng, toLat, toLng, "driving"),
    fetchGoogleDirections(fromLat, fromLng, toLat, toLng, "transit"),
  ]);

  const result: TravelTimes = {
    driveMinutes: drive ?? estimateDriveMinutes(fromLat, fromLng, toLat, toLng),
    transitMinutes: transit,
  };

  cache.set(key, result);
  return result;
}

/** Small delay helper */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AirportWithTimes {
  code: string;
  name: string;
  lat: number;
  lng: number;
  driveMinutes: number;
  transitMinutes: number | null;
}

export async function getAirportsWithTravelTimes(
  venueLat: number,
  venueLng: number,
  airports: { code: string; name: string; lat: number; lng: number }[]
): Promise<AirportWithTimes[]> {
  const results: TravelTimes[] = [];
  for (const apt of airports) {
    const times = await getTravelTimes(venueLat, venueLng, apt.lat, apt.lng);
    results.push(times);
    if (airports.length > 1) await delay(100);
  }
  return airports.map((apt, i) => ({
    code: apt.code,
    name: apt.name,
    lat: apt.lat,
    lng: apt.lng,
    driveMinutes: results[i].driveMinutes,
    transitMinutes: results[i].transitMinutes,
  }));
}
