interface TravelTimes {
  driveMinutes: number;
  transitMinutes: number | null;
  transitFare: string | null;
  transitDepartureTime: string | null;
  transitArrivalTime: string | null;
  uberEstimate: string | null;
  lyftEstimate: string | null;
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

/** Fetch driving duration from OSRM (free, no API key needed) */
async function fetchOsrmDriving(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<{ minutes: number } | null> {
  try {
    // OSRM uses lng,lat order
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const duration = data?.routes?.[0]?.duration;
    if (duration == null) return null;
    return { minutes: Math.round(duration / 60) };
  } catch {
    return null;
  }
}

/** Math-based ride-share estimate from distance + time */
function estimateRideFare(
  miles: number, minutes: number,
  baseFare: number, perMile: number, perMinute: number, minFare: number
): string {
  const low = Math.max(minFare, Math.round(baseFare + perMile * miles + perMinute * minutes));
  const high = Math.round(low * 1.3); // surge / variability buffer
  return low === high ? `~$${low}` : `~$${low}\u2013${high}`;
}

function estimateRides(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  driveMinutes: number
): { uber: string; lyft: string } {
  const miles = haversineKm(fromLat, fromLng, toLat, toLng) * 0.6214 * 1.4; // road-adjusted
  return {
    // UberX: $2.50 base + $1.50/mi + $0.25/min, $7 min
    uber: estimateRideFare(miles, driveMinutes, 2.5, 1.5, 0.25, 7),
    // Lyft: $2.00 base + $1.35/mi + $0.20/min, $6 min
    lyft: estimateRideFare(miles, driveMinutes, 2.0, 1.35, 0.20, 6),
  };
}

export async function getTravelTimes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  _transitConstraint?: { arriveBy?: number; departAfter?: number }
): Promise<TravelTimes> {
  const constraintSuffix = _transitConstraint?.arriveBy
    ? `:a${_transitConstraint.arriveBy}`
    : _transitConstraint?.departAfter
      ? `:d${_transitConstraint.departAfter}`
      : "";
  const key = cacheKey(fromLat, fromLng, toLat, toLng) + constraintSuffix;
  const cached = cache.get(key);
  if (cached) return cached;

  // Fetch driving time from OSRM
  const driveResult = await fetchOsrmDriving(fromLat, fromLng, toLat, toLng);
  const driveMin = driveResult?.minutes ?? estimateDriveMinutes(fromLat, fromLng, toLat, toLng);

  const rides = estimateRides(fromLat, fromLng, toLat, toLng, driveMin);

  // Transit not available via OSRM — GTFS handles real transit scheduling separately
  const result: TravelTimes = {
    driveMinutes: driveMin,
    transitMinutes: null,
    transitFare: null,
    transitDepartureTime: null,
    transitArrivalTime: null,
    uberEstimate: rides.uber,
    lyftEstimate: rides.lyft,
  };

  cache.set(key, result);
  return result;
}

export async function getTransitTime(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
  _transitMode: "bus" | "rail",
  _timeConstraint?: { arriveBy?: number; departAfter?: number }
): Promise<{
  minutes: number | null;
  fare: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
}> {
  // Transit-specific routing not available via free APIs
  // GTFS data handles actual transit schedules in route-search.ts
  return { minutes: null, fare: null, departureTime: null, arrivalTime: null };
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
  transitFare: string | null;
  uberEstimate: string | null;
  lyftEstimate: string | null;
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
    transitFare: results[i].transitFare,
    uberEstimate: results[i].uberEstimate,
    lyftEstimate: results[i].lyftEstimate,
  }));
}

/** Fetch OSRM route geometry for map rendering */
export async function fetchOsrmRouteGeometry(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<[number, number][] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!coords) return null;
    // GeoJSON is [lng, lat] — convert to [lat, lng] for Leaflet
    return coords.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
  } catch {
    return null;
  }
}
