"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Clock,
  Ticket,
  Star,
  ArrowUpRight,
  Hotel,
  Car,
  Bus,
  Plane,
  TrainFront,
  BusFront,
  Footprints,
  Check,
  Ban,
  Loader2,
  RefreshCw,
  Cloud,
  Sun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Droplets,
  CloudDrizzle,
  CloudFog,
  CloudSun,
  ChevronDown,
  ParkingSquare,
  Tv,
  HeartPulse,
  Beer,
  UtensilsCrossed,
  Luggage,
  Wifi,
  Plus,
  Minus,
} from "lucide-react";
import type { VenuePolicy } from "@/lib/venue-policies";
import { PlayerChip } from "./player-chip";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TransitStop {
  code: string;
  name: string;
  lat: number;
  lng: number;
  driveMinutes?: number;
  transitMinutes?: number | null;
}

export interface RouteFocus {
  venueLat: number;
  venueLng: number;
  airportLat: number;
  airportLng: number;
  airportCode: string;
  venueName: string;
  pinOnly?: boolean;
}

export interface GameEvent {
  id: string;
  name: string;
  url: string;
  est_date?: string;
  est_time: string | null;
  local_time?: string | null;
  tz?: string | null;
  date_time_utc?: string | null;
  venue: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  min_price: { amount: number; currency: string } | null;
  odds?: {
    away_team: string;
    home_team: string;
    away_win: number;
    home_win: number;
    kalshi_event: string;
  } | null;
  away_record?: string | null;
  home_record?: string | null;
  espn_price?: { amount: number; available: number; url: string | null } | null;
  broadcasts?: { national: string[]; local: string[] } | null;
  nearbyAirports?: TransitStop[];
  nearbyTrainStations?: TransitStop[];
  nearbyBusStations?: TransitStop[];
}

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

interface HourlyWeather {
  time: string;
  temp: number;
  feelsLike: number;
  precip: number;
  precipProb: number;
  weatherCode: number;
  windSpeed: number;
  humidity: number;
}

interface StationDeparture {
  carrier: string;
  routeName: string;
  headsign: string;
  mode: "bus" | "train";
  departMinutes: number;
  departTime: string;
  destination: string;
}

interface StationDepartureResult {
  code: string;
  name: string;
  departures: StationDeparture[];
}

interface NewsItem {
  title: string;
  link: string;
  source: string;
  published: string;
  snippet: string;
}

interface ParkingSpot {
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

interface RestaurantSpot {
  name: string;
  vicinity: string;
  lat: number;
  lng: number;
  distanceMiles: number;
  walkMinutes: number;
  rating: number | null;
  totalRatings: number;
  priceLevel: string | null;
  photoUrl: string | null;
  yelpUrl: string;
  directionsUrl: string;
  category: "pregame" | "postgame";
}

interface PlayerAvailability {
  name: string;
  position: string;
  jersey: string;
  status: "Playing" | "Out" | "Doubtful" | "Questionable" | "Day-To-Day";
  injuryNote?: string;
  headshot?: string;
  espnId?: string;
}

interface TeamAvailability {
  team: string;
  teamAbbr: string;
  playing: PlayerAvailability[];
  out: PlayerAvailability[];
  gameTime: PlayerAvailability[];
}

interface LastTransitInfo {
  stopCode: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  lastDeparture: string | null;
  lastArrival: string | null;
  durationMinutes: number | null;
  available: boolean;
  warning: boolean;
}

export interface GameDetailPopoverProps {
  game: GameEvent;
  visible: boolean;
  onClose: () => void;
  date: string;
  userLocation: { lat: number; lng: number } | null;
  onRouteFocus?: (focus: RouteFocus | null) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(time: string | null, tz?: string | null): string {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period} ${tz ?? "ET"}`;
}

function formatUserLocalTime(utc: string | null | undefined): { text: string; tz: string } | null {
  if (!utc) return null;
  const d = new Date(utc);
  if (isNaN(d.getTime())) return null;
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: userTz, hour: "numeric", minute: "2-digit", hour12: true });
  const tzFmt = new Intl.DateTimeFormat("en-US", { timeZone: userTz, timeZoneName: "short" });
  const tzAbbr = tzFmt.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
  return { text: timeFmt.format(d).replace(/\u202f/g, " "), tz: tzAbbr };
}

function formatDriveTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function stubhubUrl(teamName: string): string {
  const slug = teamName.replace(/\s*\(.*?\)/g, "").trim().toLowerCase().replace(/\s+/g, "-");
  return `https://www.stubhub.com/${slug}-tickets`;
}

function gmapsUrl(fromLat: number, fromLng: number, toLat: number, toLng: number, mode: "driving" | "transit", arriveByEpoch?: number) {
  let url = `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=${mode}`;
  if (arriveByEpoch) url += `&arrival_time=${arriveByEpoch}`;
  return url;
}

function uberDeepLink(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const pickup = encodeURIComponent(JSON.stringify({ source: "SEARCH", latitude: fromLat, longitude: fromLng, provider: "uber_places" }));
  const drop = encodeURIComponent(JSON.stringify({ source: "SEARCH", latitude: toLat, longitude: toLng, provider: "uber_places" }));
  return `https://m.uber.com/go/product-selection?pickup=${pickup}&drop%5B0%5D=${drop}`;
}

function lyftDeepLink(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  return `https://lyft.com/ride?pickup[latitude]=${fromLat}&pickup[longitude]=${fromLng}&destination[latitude]=${toLat}&destination[longitude]=${toLng}`;
}

function extractUpperBound(estimate: string): string {
  const parts = estimate.split(/[-–]/);
  const last = parts[parts.length - 1].trim();
  return last.startsWith("$") ? last : `$${last.replace(/[^0-9.]/g, "")}`;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function WeatherIcon({ code, className }: { code: number; className?: string }) {
  if (code === 0) return <Sun className={className} />;
  if (code <= 2) return <CloudSun className={className} />;
  if (code === 3) return <Cloud className={className} />;
  if (code >= 45 && code <= 48) return <CloudFog className={className} />;
  if (code >= 51 && code <= 57) return <CloudDrizzle className={className} />;
  if (code >= 61 && code <= 67) return <CloudRain className={className} />;
  if (code >= 71 && code <= 77) return <CloudSnow className={className} />;
  if (code >= 80 && code <= 82) return <CloudRain className={className} />;
  if (code >= 85 && code <= 86) return <CloudSnow className={className} />;
  if (code >= 95) return <CloudLightning className={className} />;
  return <Cloud className={className} />;
}

// ── TransitRows ────────────────────────────────────────────────────────────

function TransitRows({
  stops,
  icon: Icon,
  vLat,
  vLng,
  enriched,
  enriching,
  onEnrich,
  onRouteFocus: _onRouteFocus,
  isAnimating: _isAnimating,
  venueName: _venueName,
  colorClass,
  tipoffUtc,
}: {
  stops: TransitStop[];
  icon: React.ComponentType<{ className?: string }>;
  vLat: number;
  vLng: number;
  enriched: Record<string, { driveMinutes: number; transitMinutes: number | null; transitFare: string | null; uberEstimate: string | null; lyftEstimate: string | null }>;
  enriching: Set<string>;
  onEnrich: (stop: TransitStop) => void;
  onRouteFocus: (focus: RouteFocus | null) => void;
  isAnimating: boolean;
  venueName: string;
  colorClass: string;
  tipoffUtc?: string | null;
}) {
  if (stops.length === 0) return null;
  const enrichKey = (sLat: number, sLng: number) => `${vLat},${vLng};${sLat},${sLng}`;
  const arriveByEpoch = tipoffUtc ? Math.floor((new Date(tipoffUtc).getTime() - 45 * 60 * 1000) / 1000) : undefined;

  return (
    <div className="space-y-2">
      {stops.map((stop) => {
        const ek = enrichKey(stop.lat, stop.lng);
        const times = enriched[ek] ?? null;
        const loading = enriching.has(ek);
        const distMi = Math.round(haversineMiles(vLat, vLng, stop.lat, stop.lng));

        return (
          <div
            key={stop.code}
            className="rounded-xl bg-neutral-50 p-4"
          >
            {/* Header: code + distance */}
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`size-4 ${colorClass}`} />
              <a
                href={`https://www.openstreetmap.org/?mlat=${stop.lat}&mlon=${stop.lng}#map=15/${stop.lat}/${stop.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`font-bold text-sm no-underline hover:underline ${colorClass}`}
                onClick={(e) => e.stopPropagation()}
              >
                {stop.code}
              </a>
              <span className="text-xs text-[--color-dim]">{distMi} mi away</span>
            </div>
            {/* Transport options */}
            {times ? (
              <div className={`grid gap-2 ${times.transitMinutes != null ? "grid-cols-2" : "grid-cols-1"}`}>
                {/* Drive column */}
                <div className="space-y-2">
                  <a
                    href={gmapsUrl(vLat, vLng, stop.lat, stop.lng, "driving", arriveByEpoch)}
                    target="_blank" rel="noopener noreferrer"
                    className="block rounded-lg bg-neutral-50 hover:bg-neutral-100 py-2.5 px-3 no-underline transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-2">
                      <Car className="size-4 text-[--color-dim]" />
                      <span className="text-xs font-bold text-neutral-900">{formatDriveTime(times.driveMinutes)}</span>
                      <span className="text-[10px] text-neutral-500">Drive</span>
                    </div>
                    <div className="text-[10px] text-emerald-600 mt-1">
                      <span className="cursor-pointer hover:underline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(uberDeepLink(vLat, vLng, stop.lat, stop.lng), "_blank"); }}>Uber {times.uberEstimate ? `~${extractUpperBound(times.uberEstimate)}` : "--"}</span>
                      <span className="text-neutral-300 mx-1">·</span>
                      <span className="cursor-pointer hover:underline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(lyftDeepLink(vLat, vLng, stop.lat, stop.lng), "_blank"); }}>Lyft {times.lyftEstimate ? `~${extractUpperBound(times.lyftEstimate)}` : "--"}</span>
                    </div>
                  </a>
                </div>
                {/* Transit column */}
                {times.transitMinutes != null && (
                  <div className="space-y-2">
                    <a
                      href={gmapsUrl(vLat, vLng, stop.lat, stop.lng, "transit", arriveByEpoch)}
                      target="_blank" rel="noopener noreferrer"
                      className="block rounded-lg bg-neutral-50 hover:bg-neutral-100 py-2.5 px-3 no-underline transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2">
                        <Bus className="size-4 text-[--color-dim]" />
                        <span className="text-xs font-bold text-foreground">{formatDriveTime(times.transitMinutes)}</span>
                        <span className="text-[10px] text-[--color-dim]">Transit</span>
                      </div>
                      <div className="text-[10px] text-emerald-600 mt-1">{times.transitFare ?? "No fare info"}</div>
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <button
                className={`text-xs text-[--color-dim] hover:text-foreground flex items-center gap-1.5 ${loading ? "[&>svg]:animate-spin" : ""}`}
                onClick={(e) => { e.stopPropagation(); onEnrich(stop); }}
              >
                <RefreshCw className="size-3" /> {loading ? "Loading…" : "Load transit info"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function GameDetailPopover({
  game,
  visible,
  onClose,
  date,
  userLocation,
  onRouteFocus,
}: GameDetailPopoverProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [transitTab, setTransitTab] = useState<"flights" | "trains" | "buses">("flights");

  // Data state
  const [venuePhotos, setVenuePhotos] = useState<string[]>([]);
  const [weather, setWeather] = useState<HourlyWeather[] | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [availability, setAvailability] = useState<TeamAvailability[] | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [venuePolicy, setVenuePolicy] = useState<VenuePolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [hotels, setHotels] = useState<HotelSuggestion[] | null>(null);
  const [hotelsLoading, setHotelsLoading] = useState(false);
  const [parking, setParking] = useState<ParkingSpot[] | null>(null);
  const [parkingLoading, setParkingLoading] = useState(false);
  const [restaurants, setRestaurants] = useState<RestaurantSpot[] | null>(null);
  const [restaurantsLoading, setRestaurantsLoading] = useState(false);
  const [localNews, setLocalNews] = useState<NewsItem[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [lastTransit, setLastTransit] = useState<LastTransitInfo[] | null>(null);
  const [lastTransitLoading, setLastTransitLoading] = useState(false);
  const [stationDepartures, setStationDepartures] = useState<StationDepartureResult[] | null>(null);
  const [stationDeparturesLoading, setStationDeparturesLoading] = useState(false);
  const [standardBags, setStandardBags] = useState(2);
  const [compactBags, setCompactBags] = useState(0);
  const [oddsizeBags, setOddsizeBags] = useState(0);

  // Transit enrichment state (on-demand)
  const [enriched, setEnriched] = useState<Record<string, { driveMinutes: number; transitMinutes: number | null; transitFare: string | null; uberEstimate: string | null; lyftEstimate: string | null }>>({});
  const [enriching, setEnriching] = useState<Set<string>>(new Set());

  // Track which game we fetched for
  const fetchedGameId = useRef<string | null>(null);

  // Watch title visibility for sticky header
  useEffect(() => {
    const el = titleRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { root, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  // Fetch all data when game changes
  useEffect(() => {
    if (!game || !game.lat || !game.lng) return;
    if (fetchedGameId.current === game.id) return;
    fetchedGameId.current = game.id;

    const vLat = game.lat;
    const vLng = game.lng;
    const gameDate = game.est_date || date;

    // Reset state for new game
    setVenuePhotos([]);
    setWeather(null);
    setAvailability(null);
    setVenuePolicy(null);
    setHotels(null);
    setParking(null);
    setRestaurants(null);
    setLocalNews(null);
    setLastTransit(null);
    setStationDepartures(null);
    setEnriched({});
    setEnriching(new Set());
    setScrolled(false);

    // Auto-select first available transit tab
    if ((game.nearbyAirports ?? []).length > 0) setTransitTab("flights");
    else if ((game.nearbyTrainStations ?? []).length > 0) setTransitTab("trains");
    else if ((game.nearbyBusStations ?? []).length > 0) setTransitTab("buses");

    // 1. Venue photos
    fetch(`/api/venue-photos?venue=${encodeURIComponent(game.venue)}&lat=${vLat}&lng=${vLng}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.photos) setVenuePhotos(d.photos); })
      .catch(() => {});

    // 2. Weather
    setWeatherLoading(true);
    fetch(`/api/weather?lat=${vLat}&lng=${vLng}&date=${gameDate}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.hours) setWeather(d.hours); })
      .catch(() => {})
      .finally(() => setWeatherLoading(false));

    // 3. Player availability
    const codes = [game.odds?.away_team, game.odds?.home_team].filter(Boolean) as string[];
    if (codes.length > 0) {
      setAvailabilityLoading(true);
      fetch(`/api/availability?teams=${encodeURIComponent(codes.sort().join(","))}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.availability) setAvailability(d.availability); })
        .catch(() => {})
        .finally(() => setAvailabilityLoading(false));
    }

    // 4. Venue policy
    setPolicyLoading(true);
    fetch(`/api/venue-policy?venue=${encodeURIComponent(game.venue)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setVenuePolicy(d); })
      .catch(() => {})
      .finally(() => setPolicyLoading(false));

    // 5. Hotels
    setHotelsLoading(true);
    fetch(`/api/nearby-hotels?venueName=${encodeURIComponent(game.venue)}&venueLat=${vLat}&venueLng=${vLng}&date=${gameDate}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.hotels) setHotels(d.hotels); })
      .catch(() => {})
      .finally(() => setHotelsLoading(false));

    // 6. Parking
    setParkingLoading(true);
    fetch(`/api/nearby-parking?venueLat=${vLat}&venueLng=${vLng}&venueName=${encodeURIComponent(game.venue)}&date=${gameDate}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.parking) setParking(d.parking); })
      .catch(() => {})
      .finally(() => setParkingLoading(false));

    // 7. Restaurants
    setRestaurantsLoading(true);
    fetch(`/api/nearby-restaurants?venueLat=${vLat}&venueLng=${vLng}&venueName=${encodeURIComponent(game.venue)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.restaurants) setRestaurants(d.restaurants); })
      .catch(() => {})
      .finally(() => setRestaurantsLoading(false));

    // 8. Local news
    setNewsLoading(true);
    fetch(`/api/local-news?city=${encodeURIComponent(game.city)}&state=${encodeURIComponent(game.state)}&venue=${encodeURIComponent(game.venue)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.news) setLocalNews(d.news); })
      .catch(() => {})
      .finally(() => setNewsLoading(false));

    // 9. Station departures (trains & buses)
    const allTransitStops = [
      ...(game.nearbyTrainStations ?? []).map((s) => ({ code: s.code, name: s.name, lat: s.lat, lng: s.lng })),
      ...(game.nearbyBusStations ?? []).map((s) => ({ code: s.code, name: s.name, lat: s.lat, lng: s.lng })),
    ];
    if (allTransitStops.length > 0) {
      setStationDeparturesLoading(true);
      const stopsJson = encodeURIComponent(JSON.stringify(allTransitStops.slice(0, 10)));
      fetch(`/api/station-departures?stops=${stopsJson}&date=${gameDate}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.stations) setStationDepartures(d.stations); })
        .catch(() => {})
        .finally(() => setStationDeparturesLoading(false));
    }

    // 11. Last transit
    if (game.date_time_utc) {
      const transitStops = [
        ...(game.nearbyTrainStations ?? []).map((s) => ({ code: s.code, name: s.name, lat: s.lat, lng: s.lng })),
        ...(game.nearbyBusStations ?? []).map((s) => ({ code: s.code, name: s.name, lat: s.lat, lng: s.lng })),
      ];
      if (transitStops.length > 0) {
        setLastTransitLoading(true);
        const stopsParam = encodeURIComponent(JSON.stringify(transitStops.slice(0, 6)));
        fetch(`/api/last-transit?venueLat=${vLat}&venueLng=${vLng}&tipoffUtc=${encodeURIComponent(game.date_time_utc)}&stops=${stopsParam}`)
          .then((r) => r.ok ? r.json() : null)
          .then((d) => { if (d?.lastTransit) setLastTransit(d.lastTransit); })
          .catch(() => {})
          .finally(() => setLastTransitLoading(false));
      }
    }
  }, [game, date]);

  // Transit enrichment handler
  const handleEnrich = useCallback(async (stop: TransitStop) => {
    if (!game.lat || !game.lng) return;
    const key = `${game.lat},${game.lng};${stop.lat},${stop.lng}`;
    if (enriched[key] || enriching.has(key)) return;
    setEnriching((prev) => new Set(prev).add(key));
    try {
      let url = `/api/travel-times?fromLat=${game.lat}&fromLng=${game.lng}&toLat=${stop.lat}&toLng=${stop.lng}`;
      if (game.date_time_utc) {
        const arriveBy = new Date(new Date(game.date_time_utc).getTime() - 45 * 60 * 1000).toISOString();
        url += `&arriveBy=${encodeURIComponent(arriveBy)}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEnriched((prev) => ({ ...prev, [key]: data }));
      }
    } finally {
      setEnriching((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [game, enriched, enriching]);

  // Parse teams
  const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
  const home = parts[0].replace(/\s*\(.*?\)/g, "").trim();
  const away = parts.length > 1 ? parts.slice(1).join(" vs ").replace(/\s*\(.*?\)/g, "").trim() : null;
  const airports = game.nearbyAirports ?? [];
  const trains = game.nearbyTrainStations ?? [];
  const buses = game.nearbyBusStations ?? [];
  const kalshiUrl = game.odds ? `https://kalshi.com/markets/KXNBAGAME/${game.odds.kalshi_event}` : null;
  const price = game.espn_price?.amount ?? game.min_price?.amount;
  const dist = userLocation && game.lat && game.lng ? haversineMiles(userLocation.lat, userLocation.lng, game.lat, game.lng) : undefined;
  const userLocal = formatUserLocalTime(game.date_time_utc);
  const showLocal = userLocal && userLocal.tz !== (game.tz ?? "ET");
  const displayDate = game.est_date || date;
  const routeFocusHandler = onRouteFocus ?? (() => {});

  if (!game.lat || !game.lng) return null;
  const vLat = game.lat;
  const vLng = game.lng;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-white/70 backdrop-blur-md" />

      <div
        className={`absolute inset-0 bg-white overflow-hidden flex flex-col transition-transform duration-300 ease-out ${visible ? "translate-y-0" : "translate-y-full"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header — Airbnb style */}
        <div className="sticky top-0 z-10 bg-white border-b border-neutral-200">
          <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-neutral-100 transition-colors shrink-0">
                <X className="size-5 text-neutral-600" />
              </button>
              <div className={`transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`}>
                {away ? (
                  <>
                    <div className="text-sm font-semibold text-neutral-900 leading-tight truncate">{away}</div>
                    <div className="text-xs text-neutral-500 leading-tight truncate">@ {home}</div>
                  </>
                ) : (
                  <div className="text-sm font-semibold text-neutral-900 leading-tight truncate">{game.name}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {price != null && <span className="text-sm font-semibold">From ${price}</span>}
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar">
          <div className="max-w-3xl mx-auto px-6">
            {/* Venue photos — Airbnb grid */}
            {(() => {
              const photos = venuePhotos;
              if (!photos || photos.length === 0) return null;
              return (
                <div className="rounded-xl overflow-hidden mt-6 mb-2">
                  {photos.length >= 5 ? (
                    <div className="grid grid-cols-4 grid-rows-2 gap-1.5 h-[320px]">
                      <div className="col-span-2 row-span-2 relative">
                        <img src={photos[0]} alt={game.venue} className="w-full h-full object-cover rounded-l-xl" />
                      </div>
                      <div className="relative"><img src={photos[1]} alt="" className="w-full h-full object-cover" /></div>
                      <div className="relative"><img src={photos[2]} alt="" className="w-full h-full object-cover rounded-tr-xl" /></div>
                      <div className="relative"><img src={photos[3]} alt="" className="w-full h-full object-cover" /></div>
                      <div className="relative"><img src={photos[4]} alt="" className="w-full h-full object-cover rounded-br-xl" /></div>
                    </div>
                  ) : photos.length >= 3 ? (
                    <div className="grid grid-cols-3 gap-1.5 h-[240px]">
                      <div className="col-span-2 relative"><img src={photos[0]} alt={game.venue} className="w-full h-full object-cover rounded-l-xl" /></div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex-1 relative"><img src={photos[1]} alt="" className="w-full h-full object-cover rounded-tr-xl" /></div>
                        <div className="flex-1 relative"><img src={photos[2]} alt="" className="w-full h-full object-cover rounded-br-xl" /></div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-[240px]">
                      <img src={photos[0]} alt={game.venue} className="w-full h-full object-cover rounded-xl" />
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Title section */}
            <div ref={titleRef} className="pt-8 pb-6">
              {away ? (
                <h1 className="text-[26px] font-bold text-neutral-900 leading-tight">
                  {away} <span className="text-neutral-400 font-normal">@</span> {home}
                </h1>
              ) : (
                <h1 className="text-[26px] font-bold text-neutral-900 leading-tight">{game.name}</h1>
              )}
              <div className="flex items-center gap-1 mt-2 text-sm text-neutral-500">
                <span>{game.venue}</span>
                <span className="text-neutral-300">·</span>
                <span>{game.city}, {game.state}</span>
                {dist != null && <><span className="text-neutral-300">·</span><span>{Math.round(dist)} miles away</span></>}
              </div>
            </div>

            {/* Key details row */}
            <div className="flex items-center gap-x-6 pb-6 border-b border-neutral-200 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-2 shrink-0">
                <Clock className="size-5 text-neutral-400" />
                <div>
                  <div className="text-sm font-semibold text-neutral-900 whitespace-nowrap">{formatTime(game.local_time ?? game.est_time, game.tz)} · {displayDate ? new Date(displayDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : date}</div>
                  {showLocal && <div className="text-xs text-neutral-500">{userLocal.text} your time</div>}
                </div>
              </div>
              {price != null && (
                <div className="flex items-center gap-2 shrink-0">
                  <Ticket className="size-5 text-neutral-400" />
                  <div>
                    <div className={`text-sm font-semibold whitespace-nowrap ${price < 30 ? "text-emerald-600" : "text-neutral-900"}`}>From ${price}</div>
                    {game.espn_price?.available != null && game.espn_price.available > 0 && (
                      <div className="text-xs text-neutral-500 whitespace-nowrap">{game.espn_price.available.toLocaleString()} left</div>
                    )}
                  </div>
                </div>
              )}
              {game.away_record && game.home_record && (
                <div className="flex items-center gap-2 shrink-0">
                  <Star className="size-5 text-neutral-400" />
                  <div className="text-sm whitespace-nowrap">
                    <div className="font-semibold text-neutral-900">{home} {game.home_record}</div>
                    <div className="text-xs text-neutral-500">{away} {game.away_record}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Odds section */}
            {game.odds && away && (
              <div className="py-8 border-b border-neutral-200">
                <h2 className="text-[22px] font-semibold text-neutral-900 mb-4">Win probability</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-base text-neutral-600">{away}</span>
                    <span className="text-base font-semibold text-neutral-900">{game.odds.away_win}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden flex">
                    <div className="h-full rounded-l-full bg-neutral-900" style={{ width: `${game.odds.away_win}%` }} />
                    <div className="h-full rounded-r-full bg-neutral-300" style={{ width: `${game.odds.home_win}%` }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-base text-neutral-600">{home}</span>
                    <span className="text-base font-semibold text-neutral-900">{game.odds.home_win}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Player Availability */}
            {(() => {
              const avail = availability;
              const aLoading = availabilityLoading;
              if (!avail && !aLoading) return null;
              const statusColor = (s: string) => {
                if (s === "Out") return "text-red-600 bg-red-50";
                if (s === "Doubtful") return "text-blue-600 bg-blue-50";
                if (s === "Day-To-Day" || s === "Questionable") return "text-amber-600 bg-amber-50";
                return "text-emerald-600 bg-emerald-50";
              };
              return (
                <div className="py-8 border-b border-neutral-200">
                  <h2 className="text-[22px] font-semibold text-neutral-900 mb-1">Player availability</h2>
                  <p className="text-sm text-neutral-500 mb-4">Who&apos;s playing tonight</p>
                  {aLoading && !avail && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Loading rosters...</div>}
                  {avail && avail.length > 0 && (
                    <div className="space-y-6">
                      {avail.map((team) => (
                        <div key={team.teamAbbr}>
                          <h3 className="text-sm font-semibold text-neutral-900 mb-3">{team.team}</h3>

                          {/* Playing */}
                          {team.playing.length > 0 && (
                            <div className="mb-3">
                              <div className="flex items-center gap-1.5 mb-2">
                                <Check className="size-3.5 text-emerald-600" />
                                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Playing ({team.playing.length})</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {team.playing.map((p) => (
                                  <PlayerChip key={p.name} player={p} teamName={team.team} teamAbbr={team.teamAbbr} variant="playing" />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Game-time decisions */}
                          {team.gameTime.length > 0 && (
                            <div className="mb-3">
                              <div className="flex items-center gap-1.5 mb-2">
                                <HeartPulse className="size-3.5 text-amber-600" />
                                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Game-time decision ({team.gameTime.length})</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {team.gameTime.map((p) => (
                                  <PlayerChip key={p.name} player={p} teamName={team.team} teamAbbr={team.teamAbbr} variant="gameTime" />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Out */}
                          {team.out.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 mb-2">
                                <Ban className="size-3.5 text-red-500" />
                                <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">Out ({team.out.length})</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {team.out.map((p) => (
                                  <PlayerChip key={p.name} player={p} teamName={team.team} teamAbbr={team.teamAbbr} variant="out" />
                                ))}
                              </div>
                            </div>
                          )}

                          {team.playing.length === 0 && team.out.length === 0 && team.gameTime.length === 0 && (
                            <div className="text-sm text-neutral-400">Roster unavailable</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Weather */}
            {(() => {
              const hours = weather;
              const wLoading = weatherLoading;
              if (!hours && !wLoading) return null;
              const relevantHours = hours ?? [];
              return (
                <div className="py-8 border-b border-neutral-200">
                  <h2 className="text-[22px] font-semibold text-neutral-900 mb-1">Game day weather</h2>
                  <p className="text-sm text-neutral-500 mb-4">Hourly forecast at the venue</p>
                  {wLoading && !hours && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Loading...</div>}
                  {relevantHours.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                      {relevantHours.map((h) => {
                        const hr = parseInt(h.time.split("T")[1]?.split(":")[0] ?? "0");
                        const ampm = hr >= 12 ? "p" : "a";
                        const hr12 = hr % 12 || 12;
                        const tipoffHr = game.date_time_utc ? new Date(game.date_time_utc).getHours() : -1;
                        const isTipoff = hr === tipoffHr;
                        return (
                          <div key={h.time} className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl shrink-0 min-w-[56px] ${isTipoff ? "bg-neutral-900 text-white" : "bg-neutral-50"}`}>
                            <span className={`text-xs font-medium ${isTipoff ? "text-white" : "text-neutral-500"}`}>{hr12}{ampm}</span>
                            <WeatherIcon code={h.weatherCode} className={`size-5 ${isTipoff ? "text-white" : "text-neutral-700"}`} />
                            <span className={`text-sm font-semibold ${isTipoff ? "text-white" : "text-neutral-900"}`}>{h.temp}°</span>
                            {h.precipProb > 0 && <span className={`text-[10px] flex items-center gap-0.5 ${isTipoff ? "text-blue-300" : "text-blue-500"}`}><Droplets className="size-2" />{h.precipProb}%</span>}
                            {h.windSpeed >= 10 && <span className={`text-[10px] ${isTipoff ? "text-neutral-300" : "text-neutral-500"}`}>{h.windSpeed}mph</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Getting There */}
            {(airports.length > 0 || trains.length > 0 || buses.length > 0) && (
              <div className="py-8 border-b border-neutral-200">
                <h2 className="text-[22px] font-semibold text-neutral-900 mb-1">Getting there</h2>
                <p className="text-sm text-neutral-500 mb-5">Travel times target arrival 45 min before tipoff</p>
                <div className="flex border-b border-neutral-200 mb-4">
                  {([
                    { key: "flights" as const, label: "Flights", count: airports.length },
                    { key: "trains" as const, label: "Trains", count: trains.length },
                    { key: "buses" as const, label: "Buses", count: buses.length },
                  ]).filter((t) => t.count > 0).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={(e) => { e.stopPropagation(); setTransitTab(tab.key); }}
                      className={`px-4 pb-3 text-sm font-medium border-b-2 transition-colors ${
                        transitTab === tab.key
                          ? "border-neutral-900 text-neutral-900"
                          : "border-transparent text-neutral-500 hover:text-neutral-700"
                      }`}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  ))}
                </div>
                {transitTab === "flights" && airports.length > 0 && <TransitRows stops={airports} icon={Plane} vLat={vLat} vLng={vLng} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(stop)} onRouteFocus={routeFocusHandler} isAnimating={false} venueName={game.venue} colorClass="text-[--color-flight]" tipoffUtc={game.date_time_utc} />}
                {transitTab === "trains" && trains.length > 0 && <TransitRows stops={trains} icon={TrainFront} vLat={vLat} vLng={vLng} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(stop)} onRouteFocus={routeFocusHandler} isAnimating={false} venueName={game.venue} colorClass="text-[--color-train]" tipoffUtc={game.date_time_utc} />}
                {transitTab === "buses" && buses.length > 0 && <TransitRows stops={buses} icon={BusFront} vLat={vLat} vLng={vLng} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(stop)} onRouteFocus={routeFocusHandler} isAnimating={false} venueName={game.venue} colorClass="text-[--color-bus]" tipoffUtc={game.date_time_utc} />}

                {/* Station Departures (trains/buses tabs) */}
                {(transitTab === "trains" || transitTab === "buses") && (() => {
                  const wantMode = transitTab === "trains" ? "train" : "bus";
                  const sLabel = transitTab === "trains" ? "Amtrak departures" : "Bus departures";
                  const sdLoading = stationDeparturesLoading;
                  const sdData = stationDepartures;
                  const relevant = sdData?.filter((s) => s.departures.some((dep) => dep.mode === wantMode)) ?? [];
                  if (!sdLoading && relevant.length === 0 && !sdData) return null;
                  return (
                    <div className="mt-6">
                      <h3 className="text-base font-semibold text-neutral-800 mb-3">{sLabel}</h3>
                      {sdLoading && !sdData && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Checking schedules...</div>}
                      {sdData && relevant.length === 0 && <p className="text-sm text-neutral-500">No departures found for this date.</p>}
                      {relevant.length > 0 && (
                        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory no-scrollbar">
                          {relevant.map((station) => {
                            const deps = station.departures.filter((dep) => dep.mode === wantMode).slice(0, 10);
                            if (deps.length === 0) return null;
                            return (
                              <div key={station.code} className="snap-start shrink-0 w-[220px] rounded-xl border border-neutral-200 bg-white overflow-hidden">
                                <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50">
                                  <div className="text-sm font-bold text-neutral-900">{station.name}</div>
                                  <div className="text-[11px] font-medium text-neutral-500 tracking-wide">{station.code}</div>
                                </div>
                                <div className="divide-y divide-neutral-100">
                                  {deps.map((dep, i) => (
                                    <div key={i} className="px-4 py-2.5">
                                      <div className="text-sm font-bold text-neutral-900">{dep.departTime}</div>
                                      <div className="text-sm text-neutral-700 truncate">{dep.headsign || dep.destination}</div>
                                      <div className="text-[11px] text-neutral-400">{dep.carrier} · {dep.routeName}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Bag Storage */}
            {(() => {
              if (!game.date_time_utc) return null;
              const eventDate = new Date(game.date_time_utc);
              if (isNaN(eventDate.getTime())) return null;
              const from = new Date(eventDate.getTime() - 3 * 60 * 60 * 1000);
              const to = new Date(eventDate.getTime() + 3 * 60 * 60 * 1000);
              const bounceFmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
              const lhFmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
              const query = `${game.venue}, ${game.city}, ${game.state}`;
              const totalBags = standardBags + compactBags + oddsizeBags;
              const bounceUrl = `https://bounce.com/s/?_aid=03b6908d-869d-48df-b8b3-22b6df73c3b1&from=${bounceFmt(from)}&to=${bounceFmt(to)}&query=${encodeURIComponent(query)}&standardBags=${standardBags}&compactBags=${compactBags}&oddsizeBags=${oddsizeBags}`;
              const lhUrl = `https://app.luggagehero.com/home;location=${encodeURIComponent(game.city)};bags=${totalBags};from=${lhFmt(from)};to=${lhFmt(to)}?lh_landing_page_origin=${encodeURIComponent("https://luggagehero.com")}&lh_landing_page_path=%2F&lang=en`;
              return (
                <div className="py-8 border-b border-neutral-200">
                  <h2 className="text-[22px] font-semibold text-neutral-900 mb-1">Bag storage</h2>
                  <p className="text-sm text-neutral-500 mb-4">Drop your bags near the venue</p>
                  <div className="space-y-3">
                    {([["Standard bags", standardBags, setStandardBags], ["Compact bags", compactBags, setCompactBags], ["Odd-size bags", oddsizeBags, setOddsizeBags]] as [string, number, React.Dispatch<React.SetStateAction<number>>][]).map(([label, count, setter]) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-sm text-neutral-700">{label}</span>
                        <div className="flex items-center gap-3">
                          <button onClick={(e) => { e.stopPropagation(); setter((c) => Math.max(0, c - 1)); }} className="size-7 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 disabled:opacity-30" disabled={count === 0}><Minus className="size-3.5" /></button>
                          <span className="text-sm font-medium w-4 text-center">{count}</span>
                          <button onClick={(e) => { e.stopPropagation(); setter((c) => c + 1); }} className="size-7 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-50"><Plus className="size-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {totalBags > 0 && (
                    <div className="mt-4 flex gap-2">
                      <a href={bounceUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-neutral-900 text-white text-sm font-medium py-2.5 hover:bg-neutral-800 transition-colors">
                        <Luggage className="size-4" /> Bounce <ArrowUpRight className="size-3.5" />
                      </a>
                      <a href={lhUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-neutral-300 text-neutral-900 text-sm font-medium py-2.5 hover:bg-neutral-50 transition-colors">
                        <Luggage className="size-4" /> LuggageHero <ArrowUpRight className="size-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Last Transit Home */}
            {(() => {
              if (!game.date_time_utc) return null;
              const ltData = lastTransit;
              const ltLoading = lastTransitLoading;
              if (!ltData && !ltLoading) return null;
              return (
                <div className="py-8 border-b border-neutral-200">
                  <h2 className="text-[22px] font-semibold text-neutral-900 mb-1">Getting home</h2>
                  <p className="text-sm text-neutral-500 mb-4">Last transit after the game</p>
                  {ltLoading && !ltData && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Checking...</div>}
                  {ltData && ltData.length > 0 && <div className="space-y-3">{ltData.map((lt) => {
                    const depTime = lt.lastDeparture ? new Date(lt.lastDeparture) : null;
                    const depStr = depTime ? depTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : null;
                    return (<div key={lt.stopCode} className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
                      <div>
                        <div className="text-base font-semibold text-neutral-900">{lt.stopCode}</div>
                        <div className="text-xs text-neutral-500">{lt.stopName || lt.stopCode} bound</div>
                      </div>
                      {lt.available && depStr ? (
                        <div className="text-right">
                          <div className={`text-sm font-medium ${lt.warning ? "text-red-600" : "text-neutral-700"}`}>Departs {depStr}</div>
                          {lt.durationMinutes && <div className="text-xs text-neutral-500">{lt.durationMinutes} min ride to station</div>}
                          {lt.warning && <div className="text-xs text-red-600 font-medium">Service may end before game</div>}
                        </div>
                      ) : <span className="text-sm text-neutral-500">No late service</span>}
                    </div>);
                  })}</div>}
                </div>
              );
            })()}

            {/* Venue Policy */}
            {(() => {
              const policy = venuePolicy;
              const loading = policyLoading;
              if (!policy && !loading) return null;
              const allowed = policy?.items.filter((i) => i.allowed) ?? [];
              const prohibited = policy?.items.filter((i) => !i.allowed) ?? [];
              return (
                <div className="py-8 border-b border-neutral-200">
                  <h2 className="text-[22px] font-semibold text-neutral-900 mb-4">Things to know</h2>
                  {loading && !policy && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Loading...</div>}
                  {policy && (<div>
                    {(policy.clearBagRequired || policy.maxBagSize) && (
                      <div className="text-sm text-neutral-700 mb-4 p-3 bg-amber-50 rounded-xl border border-amber-200">
                        {policy.clearBagRequired && <span className="font-semibold">Clear bag required</span>}
                        {policy.maxBagSize && <span>{policy.clearBagRequired ? " · " : ""}Max {policy.maxBagSize}</span>}
                      </div>
                    )}
                    <div className="flex items-start gap-2 text-sm text-neutral-700 mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
                      <Wifi className="size-4 shrink-0 mt-0.5 text-blue-600" />
                      <span>{policy.wifiInfo || "WiFi availability unsure"}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      {allowed.length > 0 && <div><h3 className="text-sm font-semibold text-neutral-900 mb-2">Allowed</h3><div className="space-y-2">{allowed.map((item) => <div key={item.name} className="flex items-start gap-2 text-sm text-neutral-600"><Check className="size-4 shrink-0 mt-0.5 text-emerald-600" /><span>{item.name}</span></div>)}</div></div>}
                      {prohibited.length > 0 && <div><h3 className="text-sm font-semibold text-neutral-900 mb-2">Not allowed</h3><div className="space-y-2">{prohibited.map((item) => <div key={item.name} className="flex items-start gap-2 text-sm text-neutral-600"><Ban className="size-4 shrink-0 mt-0.5 text-red-500" /><span>{item.name}</span></div>)}</div></div>}
                    </div>
                    {policy.policyUrl && <a href={policy.policyUrl} target="_blank" rel="noopener noreferrer" className="mt-4 text-sm text-neutral-900 underline font-semibold inline-flex items-center gap-1 hover:text-neutral-600">Show full policy <ArrowUpRight className="size-3.5" /></a>}
                  </div>)}
                </div>
              );
            })()}

            {/* Hotels */}
            {(() => {
              const h = hotels;
              const loading = hotelsLoading;
              if (!h && !loading) return null;
              return (
                <div className="py-8 border-b border-neutral-200">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-[22px] font-semibold text-neutral-900">Where to stay</h2>
                    {h && h.length > 0 && <a href={h[0].bookingUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-neutral-900 underline hover:text-neutral-600">More on Google</a>}
                  </div>
                  {loading && !h && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Loading...</div>}
                  {h && h.length > 0 && (
                    <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-6 px-6 pb-2">
                      {h.map((hotel, hi) => (
                        <a key={hi} href={hotel.bookingUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-[240px] rounded-xl overflow-hidden hover:shadow-lg transition-shadow no-underline block group">
                          <div className="h-[160px] bg-neutral-100 overflow-hidden">
                            {hotel.photoUrl ? (
                              <img src={hotel.photoUrl} alt={hotel.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-400"><Hotel className="size-10" /></div>
                            )}
                          </div>
                          <div className="p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-semibold text-neutral-900 truncate flex-1">{hotel.name}</div>
                              {hotel.rating && <span className="flex items-center gap-0.5 text-sm shrink-0 ml-2"><Star className="size-3.5 text-neutral-900" /> {hotel.rating}</span>}
                            </div>
                            <div className="text-sm text-neutral-500 mt-0.5">{hotel.distanceMiles} mi from venue</div>
                            <div className="text-sm font-semibold text-neutral-900 mt-1">{hotel.estimatedPrice}</div>
                            <div className="flex items-center gap-2 mt-2 text-xs text-neutral-500">
                              <span className="flex items-center gap-1"><Car className="size-3" /> {hotel.driveMinutes}m</span>
                              {hotel.transitMinutes != null && <span className="flex items-center gap-1"><Bus className="size-3" /> {hotel.transitMinutes}m</span>}
                              <span className="flex items-center gap-1"><Footprints className="size-3" /> {hotel.walkMinutes}m</span>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Parking */}
            {(() => {
              const spots = parking;
              const pLoading = parkingLoading;
              if (!spots && !pLoading) return null;
              return (
                <div className="py-8 border-b border-neutral-200">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-[22px] font-semibold text-neutral-900">Parking</h2>
                    {spots && spots.length > 0 && <a href={spots[0].spotHeroUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-neutral-900 underline hover:text-neutral-600">Reserve on SpotHero</a>}
                  </div>
                  <p className="text-sm text-neutral-500 mb-4">Spots open during event hours (2h before to 2h after)</p>
                  {pLoading && !spots && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Finding parking...</div>}
                  {spots && spots.length > 0 && (
                    <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-6 px-6 pb-2">
                      {spots.map((p, i) => (
                        <a key={i} href={p.directionsUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-[200px] rounded-xl overflow-hidden hover:shadow-lg transition-shadow no-underline block group">
                          <div className="h-[120px] bg-neutral-100 overflow-hidden">
                            {p.photoUrl ? (
                              <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-neutral-400"><ParkingSquare className="size-8" /></div>
                            )}
                          </div>
                          <div className="p-3">
                            <div className="text-sm font-semibold text-neutral-900 truncate">{p.name}</div>
                            <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                              <span className="flex items-center gap-0.5"><Footprints className="size-3" /> {p.walkMinutes}m walk</span>
                              {p.rating && <span className="flex items-center gap-0.5"><Star className="size-3 text-neutral-900" /> {p.rating}</span>}
                            </div>
                            {p.estimatedPrice && <div className="text-sm font-semibold text-neutral-900 mt-1">{p.estimatedPrice}</div>}
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Good Eats */}
            {(() => {
              const spots = restaurants;
              const rLoading = restaurantsLoading;
              if (!spots && !rLoading) return null;
              const pregame = spots?.filter((r) => r.category === "pregame") ?? [];
              const postgame = spots?.filter((r) => r.category === "postgame") ?? [];
              const yelpUrl = `https://www.yelp.com/search?find_desc=restaurants&find_loc=${encodeURIComponent(game.venue + " " + game.city + " " + game.state)}`;
              return (
                <div className="py-8 border-b border-neutral-200">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-[22px] font-semibold text-neutral-900">Good Eats</h2>
                    <a href={yelpUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-neutral-900 underline hover:text-neutral-600">More on Yelp</a>
                  </div>
                  <p className="text-sm text-neutral-500 mb-4">Open 1h before tipoff &amp; 1h after the game</p>
                  {rLoading && !spots && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Finding restaurants...</div>}

                  {pregame.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 mb-3">
                        <Beer className="size-4 text-neutral-700" />
                        <h3 className="text-base font-semibold text-neutral-800">Pregame</h3>
                      </div>
                      <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-6 px-6 pb-2">
                        {pregame.map((r, i) => (
                          <a key={i} href={r.directionsUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-[200px] rounded-xl overflow-hidden hover:shadow-lg transition-shadow no-underline block group">
                            <div className="h-[120px] bg-neutral-100 overflow-hidden">
                              {r.photoUrl ? (
                                <img src={r.photoUrl} alt={r.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-neutral-400"><Beer className="size-8" /></div>
                              )}
                            </div>
                            <div className="p-3">
                              <div className="text-sm font-semibold text-neutral-900 truncate">{r.name}</div>
                              <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                                <span className="flex items-center gap-0.5"><Footprints className="size-3" /> {r.walkMinutes}m walk</span>
                                {r.rating && <span className="flex items-center gap-0.5"><Star className="size-3 text-neutral-900" /> {r.rating}</span>}
                              </div>
                              {r.priceLevel && <div className="text-xs text-neutral-500 mt-1">{r.priceLevel} {r.priceLevel === "$" ? "($5–15)" : r.priceLevel === "$$" ? "($15–30)" : r.priceLevel === "$$$" ? "($30–60)" : r.priceLevel === "$$$$" ? "($60+)" : ""}</div>}
                            </div>
                          </a>
                        ))}
                      </div>
                    </>
                  )}

                  {postgame.length > 0 && (
                    <>
                      <div className={`flex items-center gap-1.5 mb-3 ${pregame.length > 0 ? "mt-6" : ""}`}>
                        <UtensilsCrossed className="size-4 text-neutral-700" />
                        <h3 className="text-base font-semibold text-neutral-800">Postgame</h3>
                      </div>
                      <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-6 px-6 pb-2">
                        {postgame.map((r, i) => (
                          <a key={i} href={r.directionsUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-[200px] rounded-xl overflow-hidden hover:shadow-lg transition-shadow no-underline block group">
                            <div className="h-[120px] bg-neutral-100 overflow-hidden">
                              {r.photoUrl ? (
                                <img src={r.photoUrl} alt={r.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-neutral-400"><UtensilsCrossed className="size-8" /></div>
                              )}
                            </div>
                            <div className="p-3">
                              <div className="text-sm font-semibold text-neutral-900 truncate">{r.name}</div>
                              <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                                <span className="flex items-center gap-0.5"><Footprints className="size-3" /> {r.walkMinutes}m walk</span>
                                {r.rating && <span className="flex items-center gap-0.5"><Star className="size-3 text-neutral-900" /> {r.rating}</span>}
                              </div>
                              {r.priceLevel && <div className="text-xs text-neutral-500 mt-1">{r.priceLevel} {r.priceLevel === "$" ? "($5–15)" : r.priceLevel === "$$" ? "($15–30)" : r.priceLevel === "$$$" ? "($30–60)" : r.priceLevel === "$$$$" ? "($60+)" : ""}</div>}
                            </div>
                          </a>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* Watch Online */}
            {game.broadcasts && (game.broadcasts.national.length > 0 || game.broadcasts.local.length > 0) && (() => {
              const streamLinks: Record<string, { url: string; icon: string }> = {
                "ESPN": { url: "https://www.espn.com/watch/", icon: "https://www.google.com/s2/favicons?domain=espn.com&sz=32" },
                "ESPN2": { url: "https://www.espn.com/watch/", icon: "https://www.google.com/s2/favicons?domain=espn.com&sz=32" },
                "ABC": { url: "https://abc.com/watch-live/", icon: "https://www.google.com/s2/favicons?domain=abc.com&sz=32" },
                "TNT": { url: "https://www.tntdrama.com/watchtnt", icon: "https://www.google.com/s2/favicons?domain=tntdrama.com&sz=32" },
                "truTV": { url: "https://www.trutv.com/watchtrutv", icon: "https://www.google.com/s2/favicons?domain=trutv.com&sz=32" },
                "NBA TV": { url: "https://www.nba.com/watch/nba-tv", icon: "https://www.google.com/s2/favicons?domain=nba.com&sz=32" },
                "NBATV": { url: "https://www.nba.com/watch/nba-tv", icon: "https://www.google.com/s2/favicons?domain=nba.com&sz=32" },
                "FanDuel SN DET": { url: "https://fanduelsportsnetwork.com/", icon: "https://www.google.com/s2/favicons?domain=fanduelsportsnetwork.com&sz=32" },
                "GCSEN": { url: "https://www.nba.com/pelicans/broadcasting", icon: "https://www.google.com/s2/favicons?domain=nba.com&sz=32" },
                "Pelicans.com": { url: "https://watch.pelicans.com", icon: "https://www.google.com/s2/favicons?domain=pelicans.com&sz=32" },
              };
              const getNetworkIcon = (name: string): string | null => {
                if (name.startsWith("FanDuel SN")) return "https://www.google.com/s2/favicons?domain=fanduelsportsnetwork.com&sz=32";
                if (name.startsWith("NBC Sports")) return "https://www.google.com/s2/favicons?domain=nbcsports.com&sz=32";
                if (name.startsWith("Bally Sports")) return "https://www.google.com/s2/favicons?domain=ballysports.com&sz=32";
                if (name.includes("MSG")) return "https://www.google.com/s2/favicons?domain=msgnetworks.com&sz=32";
                if (name === "YES" || name === "YES Network") return "https://www.google.com/s2/favicons?domain=yesnetwork.com&sz=32";
                if (name === "NESN" || name === "NESN+") return "https://www.google.com/s2/favicons?domain=nesn.com&sz=32";
                if (name.endsWith(".com")) return `https://www.google.com/s2/favicons?domain=${name}&sz=32`;
                return null;
              };
              const allNetworks = [...game.broadcasts!.national, ...game.broadcasts!.local];
              const isNational = game.broadcasts!.national.length > 0;
              return (
                <div className="py-8 border-b border-neutral-200">
                  <h2 className="text-[22px] font-semibold text-neutral-900 mb-1">Watch online</h2>
                  <p className="text-sm text-neutral-500 mb-4">{isNational ? "Nationally televised" : "Local broadcast"} — {isNational ? "catch the big game from anywhere" : "check local listings or NBA League Pass"}</p>
                  <div className="flex flex-wrap gap-2">
                    {allNetworks.map((name) => {
                      const link = streamLinks[name];
                      const fallbackIcon = !link ? getNetworkIcon(name) : null;
                      return link ? (
                        <a key={name} href={link.url} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-lg border border-neutral-200 text-sm font-medium text-neutral-900 hover:bg-neutral-50 hover:shadow-sm no-underline transition-all inline-flex items-center gap-2">
                          <img src={link.icon} alt="" className="size-4 rounded-sm" />
                          {name}
                          <ArrowUpRight className="size-3.5 text-neutral-400" />
                        </a>
                      ) : (
                        <span key={name} className="px-4 py-2.5 rounded-lg border border-neutral-200 text-sm font-medium text-neutral-900 inline-flex items-center gap-2">
                          {fallbackIcon ? <img src={fallbackIcon} alt="" className="size-4 rounded-sm" /> : <Tv className="size-4 text-neutral-400" />}
                          {name}
                        </span>
                      );
                    })}
                    <a href="https://www.nba.com/watch/league-pass" target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-lg border border-neutral-200 text-sm font-medium text-neutral-900 hover:bg-neutral-50 hover:shadow-sm no-underline transition-all inline-flex items-center gap-2">
                      <img src="https://www.google.com/s2/favicons?domain=nba.com&sz=32" alt="" className="size-4 rounded-sm" />
                      NBA League Pass
                      <ArrowUpRight className="size-3.5 text-neutral-400" />
                    </a>
                  </div>
                </div>
              );
            })()}

            {/* Local News */}
            {(() => {
              const news = localNews;
              const nLoading = newsLoading;
              if (!news && !nLoading) return null;
              return (
                <details className="py-8 border-b border-neutral-200 group">
                  <summary className="text-[22px] font-semibold text-neutral-900 cursor-pointer list-none select-none flex items-center justify-between">
                    Local news
                    <ChevronDown className="size-5 text-neutral-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-4">
                    {nLoading && !news && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Loading...</div>}
                    {news && news.length > 0 && <div className="divide-y divide-neutral-100">{news.map((n, i) => (
                      <a key={i} href={n.link} target="_blank" rel="noopener noreferrer" className="block py-4 no-underline hover:bg-neutral-50 -mx-3 px-3 rounded-lg transition-colors">
                        <div className="text-[15px] font-medium text-neutral-900 leading-snug">{n.title}</div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-xs text-neutral-500">{n.source}</span>
                          {n.published && <span className="text-xs text-neutral-400">{new Date(n.published).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                        </div>
                      </a>
                    ))}</div>}
                  </div>
                </details>
              );
            })()}

            {/* Links */}
            <div className="py-8">
              <h2 className="text-[22px] font-semibold text-neutral-900 mb-4">Tickets & links</h2>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Ticketmaster", href: game.url, icon: "https://www.google.com/s2/favicons?domain=ticketmaster.com&sz=32" },
                  away ? { label: "StubHub", href: stubhubUrl(home), icon: "https://www.google.com/s2/favicons?domain=stubhub.com&sz=32" } : null,
                  game.espn_price?.url ? { label: "VividSeats", href: game.espn_price.url, icon: "https://www.google.com/s2/favicons?domain=vividseats.com&sz=32" } : null,
                  kalshiUrl ? { label: "Kalshi", href: kalshiUrl, icon: "https://www.google.com/s2/favicons?domain=kalshi.com&sz=32" } : null,
                  { label: "ESPN", href: `https://www.espn.com/nba/scoreboard/_/date/${displayDate.replace(/-/g, "")}`, icon: "https://www.google.com/s2/favicons?domain=espn.com&sz=32" },
                  venuePolicy?.websiteUrl ? { label: "Venue site", href: venuePolicy.websiteUrl, icon: "https://www.google.com/s2/favicons?domain=" + new URL(venuePolicy.websiteUrl).hostname + "&sz=32" } : null,
                ].filter(Boolean).map((link) => (
                  <a key={link!.label} href={link!.href} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-lg border border-neutral-200 text-sm font-medium text-neutral-900 hover:bg-neutral-50 hover:shadow-sm no-underline transition-all inline-flex items-center gap-2">
                    <img src={(link as { icon: string }).icon} alt="" className="size-4 rounded-sm" />
                    {link!.label}
                    <ArrowUpRight className="size-3.5 text-neutral-400" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
