"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RouteFocus, TransitStop, VenueInfo } from "./game-map";
import {
  ChevronUp,
  Plane,
  Car,
  Bus,
  TrainFront,
  BusFront,
  ArrowUpRight,
  RefreshCw,
  Navigation,
  ShieldCheck,
  Check,
  Ban,
  Loader2,
  SlidersHorizontal,
  Map,
  Circle,
  CheckCircle2,
  Hotel,
  Star,
  MapPin,
  Footprints,
  Cloud,
  Sun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Droplets,
  Wind,
  Thermometer,
  CloudDrizzle,
  CloudFog,
  CloudSun,
  AlertTriangle,
  Clock,
  Newspaper,
  ChevronDown,
  ExternalLink,
  ParkingSquare,
  Timer,
  X,
  Ticket,
} from "lucide-react";
import type { VenuePolicy } from "@/lib/venue-policies";
import { SearchBar } from "./search-bar";
import { DateSelector } from "./date-selector";
import { useRampage } from "@/lib/rampage-context";
import { useRouter } from "next/navigation";

type TrayState = "collapsed" | "peek" | "expanded";

interface GameEvent {
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
  odds: {
    away_team: string;
    home_team: string;
    away_win: number;
    home_win: number;
    kalshi_event: string;
  } | null;
  away_record?: string | null;
  home_record?: string | null;
  espn_price?: { amount: number; available: number; url: string | null } | null;
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

function formatTime(time: string | null, tz?: string | null) {
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
  // e.g. "$18-24" → "$24", "$18–$24" → "$24", "$24" → "$24"
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

function weatherLabel(code: number): string {
  const labels: Record<number, string> = {
    0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime Fog", 51: "Lt Drizzle", 53: "Drizzle", 55: "Hvy Drizzle",
    56: "Frz Drizzle", 57: "Frz Drizzle", 61: "Lt Rain", 63: "Rain", 65: "Hvy Rain",
    66: "Frz Rain", 67: "Frz Rain", 71: "Lt Snow", 73: "Snow", 75: "Hvy Snow",
    77: "Snow Grains", 80: "Lt Showers", 81: "Showers", 82: "Hvy Showers",
    85: "Snow Shwrs", 86: "Hvy Snow Shwrs", 95: "T-Storm", 96: "T-Storm+Hail", 99: "T-Storm+Hail",
  };
  return labels[code] ?? "Unknown";
}

type SortKey = "time" | "price" | "dist" | "odds" | "record" | "team";
type SortDir = "asc" | "desc";
type ColumnId = "ticket" | "record" | "odds" | "team" | "stadium" | "time";

const SORT_KEYS: SortKey[] = ["time", "price", "dist", "odds", "record", "team"];
const ALL_COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "ticket", label: "Ticket" },
  { id: "record", label: "Record" },
  { id: "odds", label: "Odds" },
  { id: "team", label: "Team" },
  { id: "stadium", label: "Stadium" },
  { id: "time", label: "Time" },
];
function getDefaultColumns(): Set<ColumnId> {
  if (typeof window === "undefined") return new Set(["ticket", "record", "odds", "team", "stadium", "time"]);
  const w = window.innerWidth;
  if (w < 640) return new Set(["ticket", "team", "time"]);
  if (w < 768) return new Set(["ticket", "team", "stadium", "time"]);
  return new Set(["ticket", "record", "odds", "team", "stadium", "time"]);
}

function TransitRows({
  stops,
  icon: Icon,
  vLat,
  vLng,
  enriched,
  enriching,
  onEnrich,
  onRouteFocus,
  isAnimating,
  venueName,
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
  // 45 minutes before tipoff as Unix epoch seconds
  const arriveByEpoch = tipoffUtc ? Math.floor((new Date(tipoffUtc).getTime() - 45 * 60 * 1000) / 1000) : undefined;

  return (
    <div className="space-y-2">
      {stops.map((stop) => {
        const ek = enrichKey(stop.lat, stop.lng);
        const times = enriched[ek] ?? null;
        const loading = enriching.has(ek);
        const baseFocus = { venueLat: vLat, venueLng: vLng, airportLat: stop.lat, airportLng: stop.lng, airportCode: stop.code, venueName };
        const distMi = Math.round(haversineMiles(vLat, vLng, stop.lat, stop.lng));

        return (
          <div
            key={stop.code}
            className="rounded-xl bg-white/5 p-3 font-mono"
            onMouseEnter={() => !isAnimating && onRouteFocus(baseFocus)}
            onMouseLeave={() => !isAnimating && onRouteFocus(null)}
          >
            {/* Header: code + distance */}
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`size-4 ${colorClass}`} />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`font-bold text-sm no-underline hover:underline ${colorClass}`}
                onClick={(e) => e.stopPropagation()}
              >
                {stop.code}
              </a>
              <span className="text-xs text-[--color-dim]">{distMi} mi away</span>
            </div>
            {/* Transport grid */}
            {times ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <a
                  href={gmapsUrl(vLat, vLng, stop.lat, stop.lng, "driving", arriveByEpoch)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex flex-col items-center gap-0.5 rounded-lg bg-white/5 hover:bg-white/10 py-2 px-1 no-underline transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Car className="size-4 text-[--color-dim]" />
                  <span className="text-xs font-bold text-foreground">{formatDriveTime(times.driveMinutes)}</span>
                  <span className="text-[10px] text-[--color-dim]">Drive</span>
                </a>
                {times.transitMinutes != null && (
                  <a
                    href={gmapsUrl(vLat, vLng, stop.lat, stop.lng, "transit", arriveByEpoch)}
                    target="_blank" rel="noopener noreferrer"
                    className="flex flex-col items-center gap-0.5 rounded-lg bg-white/5 hover:bg-white/10 py-2 px-1 no-underline transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Bus className="size-4 text-[--color-dim]" />
                    <span className="text-xs font-bold text-foreground">{formatDriveTime(times.transitMinutes)}</span>
                    <span className="text-[10px] text-emerald-400">{times.transitFare ?? "--"}</span>
                  </a>
                )}
                <a
                  href={uberDeepLink(vLat, vLng, stop.lat, stop.lng)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex flex-col items-center gap-0.5 rounded-lg bg-white/5 hover:bg-white/10 py-2 px-1 no-underline transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[10px] font-bold text-[--color-dim]">UBER</span>
                  <span className="text-xs font-bold text-emerald-400">{times.uberEstimate ? `~${extractUpperBound(times.uberEstimate)}` : "--"}</span>
                </a>
                <a
                  href={lyftDeepLink(vLat, vLng, stop.lat, stop.lng)}
                  target="_blank" rel="noopener noreferrer"
                  className="flex flex-col items-center gap-0.5 rounded-lg bg-white/5 hover:bg-white/10 py-2 px-1 no-underline transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[10px] font-bold text-[--color-dim]">LYFT</span>
                  <span className="text-xs font-bold text-emerald-400">{times.lyftEstimate ? `~${extractUpperBound(times.lyftEstimate)}` : "--"}</span>
                </a>
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

export function BottomTray({
  games,
  date,
  selectedVenue,
  hoveredVenue,
  onVenueHover,
  onVenueClick,
  onRouteFocus,
  trayState,
  onTrayStateChange,
  userLocation,
  allAirports,
  showOdds,
  search,
  onSearchChange,
  availableDates,
  onDateChange,
  gameCountByDate,
  onLocationChange,
}: {
  games: GameEvent[];
  date: string;
  selectedVenue: string | null;
  hoveredVenue?: string | null;
  onVenueHover?: (venue: string | null) => void;
  onVenueClick: (venue: VenueInfo) => void;
  onRouteFocus: (focus: RouteFocus | null) => void;
  trayState: TrayState;
  onTrayStateChange: (state: TrayState) => void;
  userLocation: { lat: number; lng: number } | null;
  allAirports?: { code: string; name: string; lat: number; lng: number }[];
  showOdds: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  availableDates: string[];
  onDateChange: (date: string) => void;
  gameCountByDate: Record<string, number>;
  onLocationChange: (loc: { lat: number; lng: number } | null) => void;
}) {
  const rampage = useRampage();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTrayState = useRef(trayState);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [popoverEventId, setPopoverEventId] = useState<string | null>(null);
  const [popoverVisible, setPopoverVisible] = useState(false);

  const openPopover = useCallback((id: string) => {
    setPopoverEventId(id);
    // Trigger animation on next frame
    requestAnimationFrame(() => requestAnimationFrame(() => setPopoverVisible(true)));
  }, []);

  const closePopover = useCallback(() => {
    setPopoverVisible(false);
    setTimeout(() => setPopoverEventId(null), 300); // match transition duration
  }, []);


  // Sort state
  const trayLsKey = "balltastic_tray";
  function loadTray(): Record<string, unknown> {
    try { return JSON.parse(localStorage.getItem(trayLsKey) ?? "{}"); } catch { return {}; }
  }
  function saveTray(patch: Record<string, unknown>) {
    try { const prev = loadTray(); localStorage.setItem(trayLsKey, JSON.stringify({ ...prev, ...patch })); } catch { /* */ }
  }
  const saved = useRef(loadTray());

  const [sortKey, setSortKey] = useState<SortKey>((saved.current.sortKey as SortKey) ?? "time");
  const [sortDir, setSortDir] = useState<SortDir>((saved.current.sortDir as SortDir) ?? "asc");
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(() => {
    const raw = saved.current.visibleColumns as ColumnId[] | undefined;
    return raw ? new Set(raw) : getDefaultColumns();
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { saveTray({ sortKey, sortDir, visibleColumns: Array.from(visibleColumns) }); }, [sortKey, sortDir, visibleColumns]);

  const toggleColumn = useCallback((col: ColumnId) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) { if (next.size > 1) next.delete(col); } else { next.add(col); }
      return next;
    });
  }, []);

  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showFilters) return;
    const handler = (e: PointerEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [showFilters]);

  // Distances
  const distanceMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!userLocation) return map;
    for (const g of games) {
      if (g.lat != null && g.lng != null) {
        map[g.id] = haversineMiles(userLocation.lat, userLocation.lng, g.lat, g.lng);
      }
    }
    return map;
  }, [games, userLocation]);

  // Nearest user airport
  const nearestUserAirport = useMemo(() => {
    if (!userLocation) return null;
    const airports = allAirports && allAirports.length > 0 ? allAirports : games.flatMap((g) => g.nearbyAirports ?? []);
    let best: { code: string; dist: number } | null = null;
    const seen = new Set<string>();
    for (const apt of airports) {
      if (seen.has(apt.code)) continue;
      seen.add(apt.code);
      const d = haversineMiles(userLocation.lat, userLocation.lng, apt.lat, apt.lng);
      if (!best || d < best.dist) best = { code: apt.code, dist: d };
    }
    return best?.code ?? null;
  }, [allAirports, games, userLocation]);

  const handleHeaderSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey]);

  const sortedGames = useMemo(() => {
    const sorted = [...games].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "time": {
          const tA = a.est_time ?? "99:99";
          const tB = b.est_time ?? "99:99";
          cmp = tA.localeCompare(tB);
          break;
        }
        case "dist": {
          const dA = distanceMap[a.id] ?? Infinity;
          const dB = distanceMap[b.id] ?? Infinity;
          cmp = dA - dB;
          break;
        }
        case "odds": {
          const sA = a.odds ? Math.abs(a.odds.away_win - a.odds.home_win) : Infinity;
          const sB = b.odds ? Math.abs(b.odds.away_win - b.odds.home_win) : Infinity;
          cmp = sA - sB;
          break;
        }
        case "price": {
          const pA = a.espn_price?.amount ?? a.min_price?.amount ?? Infinity;
          const pB = b.espn_price?.amount ?? b.min_price?.amount ?? Infinity;
          cmp = pA - pB;
          break;
        }
        case "record": {
          function recDiff(away: string | null | undefined, home: string | null | undefined): number {
            if (!away || !home) return Infinity;
            const pa = away.split("-").map(Number);
            const ph = home.split("-").map(Number);
            if (pa.length < 2 || ph.length < 2) return Infinity;
            const tA = pa[0] + pa[1];
            const tH = ph[0] + ph[1];
            if (tA === 0 || tH === 0) return Infinity;
            return Math.abs(pa[0] / tA - ph[0] / tH);
          }
          cmp = recDiff(a.away_record, a.home_record) - recDiff(b.away_record, b.home_record);
          break;
        }
        case "team": {
          const parseName = (n: string) => {
            const p = n.split(/\s+(?:vs?\.?|VS\.?)\s+/);
            return (p.length > 1 ? p.slice(1).join(" ") : p[0]).replace(/\s*\(.*?\)/g, "").trim();
          };
          cmp = parseName(a.name).localeCompare(parseName(b.name));
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [games, sortKey, sortDir, distanceMap]);

  // Enrichment state
  const [enriched, setEnriched] = useState<Record<string, { driveMinutes: number; transitMinutes: number | null; transitFare: string | null; uberEstimate: string | null; lyftEstimate: string | null }>>({});
  const [enriching, setEnriching] = useState<Set<string>>(new Set());

  const enrichKey = (vLat: number, vLng: number, sLat: number, sLng: number) =>
    `${vLat},${vLng};${sLat},${sLng}`;

  const handleEnrich = useCallback(async (venueLat: number, venueLng: number, stop: TransitStop, tipoffUtc?: string | null) => {
    const key = enrichKey(venueLat, venueLng, stop.lat, stop.lng);
    if (enriched[key] || enriching.has(key)) return;
    setEnriching((prev) => new Set(prev).add(key));
    try {
      let url = `/api/travel-times?fromLat=${venueLat}&fromLng=${venueLng}&toLat=${stop.lat}&toLng=${stop.lng}`;
      if (tipoffUtc) {
        const arriveBy = new Date(new Date(tipoffUtc).getTime() - 45 * 60 * 1000).toISOString();
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
  }, [enriched, enriching]);

  // Venue policy state
  const [venuePolicies, setVenuePolicies] = useState<Record<string, VenuePolicy>>({});
  const [policyLoading, setPolicyLoading] = useState<Set<string>>(new Set());
  const policyFailed = useRef<Set<string>>(new Set());

  const handlePolicyLoad = useCallback(async (venueName: string) => {
    if (venuePolicies[venueName] || policyLoading.has(venueName) || policyFailed.current.has(venueName)) return;
    setPolicyLoading((prev) => new Set(prev).add(venueName));
    try {
      const res = await fetch(`/api/venue-policy?venue=${encodeURIComponent(venueName)}`);
      if (res.ok) {
        const data: VenuePolicy = await res.json();
        setVenuePolicies((prev) => ({ ...prev, [venueName]: data }));
      } else {
        policyFailed.current.add(venueName);
      }
    } catch {
      policyFailed.current.add(venueName);
    } finally {
      setPolicyLoading((prev) => {
        const next = new Set(prev);
        next.delete(venueName);
        return next;
      });
    }
  }, [venuePolicies, policyLoading]);

  // Nearby hotels state
  const [nearbyHotels, setNearbyHotels] = useState<Record<string, HotelSuggestion[]>>({});
  const [hotelsLoading, setHotelsLoading] = useState<Set<string>>(new Set());
  const hotelsFailed = useRef<Set<string>>(new Set());

  const handleHotelsLoad = useCallback(async (venueName: string, venueLat: number, venueLng: number, gameDate: string) => {
    if (nearbyHotels[venueName] || hotelsLoading.has(venueName) || hotelsFailed.current.has(venueName)) return;
    setHotelsLoading((prev) => new Set(prev).add(venueName));
    try {
      const res = await fetch(`/api/nearby-hotels?venueName=${encodeURIComponent(venueName)}&venueLat=${venueLat}&venueLng=${venueLng}&date=${gameDate}`);
      if (res.ok) {
        const data = await res.json();
        setNearbyHotels((prev) => ({ ...prev, [venueName]: data.hotels }));
      } else {
        hotelsFailed.current.add(venueName);
      }
    } catch {
      hotelsFailed.current.add(venueName);
    } finally {
      setHotelsLoading((prev) => {
        const next = new Set(prev);
        next.delete(venueName);
        return next;
      });
    }
  }, [nearbyHotels, hotelsLoading]);

  // Weather state
  interface HourlyWeather { time: string; temp: number; feelsLike: number; precip: number; precipProb: number; weatherCode: number; windSpeed: number; humidity: number }
  const [weather, setWeather] = useState<Record<string, HourlyWeather[]>>({});
  const [weatherLoading, setWeatherLoading] = useState<Set<string>>(new Set());
  const weatherFailed = useRef<Set<string>>(new Set());

  const handleWeatherLoad = useCallback(async (venueLat: number, venueLng: number, gameDate: string) => {
    const key = `${venueLat},${venueLng},${gameDate}`;
    if (weather[key] || weatherLoading.has(key) || weatherFailed.current.has(key)) return;
    setWeatherLoading((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(`/api/weather?lat=${venueLat}&lng=${venueLng}&date=${gameDate}`);
      if (res.ok) {
        const data = await res.json();
        setWeather((prev) => ({ ...prev, [key]: data.hours }));
      } else {
        weatherFailed.current.add(key);
      }
    } catch {
      weatherFailed.current.add(key);
    } finally {
      setWeatherLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [weather, weatherLoading]);

  // Airport delays state
  interface AirportDelay { code: string; name: string; delayIndex: number | null; departureDel: number | null; arrivalDel: number | null; reasons: string[] }
  const [airportDelays, setAirportDelays] = useState<Record<string, AirportDelay[]>>({});
  const [delaysLoading, setDelaysLoading] = useState<Set<string>>(new Set());
  const delaysFailed = useRef<Set<string>>(new Set());

  const handleDelaysLoad = useCallback(async (airportCodes: string[]) => {
    const key = airportCodes.sort().join(",");
    if (!key || airportDelays[key] || delaysLoading.has(key) || delaysFailed.current.has(key)) return;
    setDelaysLoading((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(`/api/airport-delays?codes=${encodeURIComponent(key)}`);
      if (res.ok) {
        const data = await res.json();
        setAirportDelays((prev) => ({ ...prev, [key]: data.delays }));
      } else {
        delaysFailed.current.add(key);
      }
    } catch {
      delaysFailed.current.add(key);
    } finally {
      setDelaysLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [airportDelays, delaysLoading]);

  // Local news state
  interface NewsItem { title: string; link: string; source: string; published: string; snippet: string }
  const [localNews, setLocalNews] = useState<Record<string, NewsItem[]>>({});
  const [newsLoading, setNewsLoading] = useState<Set<string>>(new Set());
  const newsFailed = useRef<Set<string>>(new Set());

  const handleNewsLoad = useCallback(async (city: string, state: string, venue: string) => {
    const key = `${city},${state}`;
    if (localNews[key] || newsLoading.has(key) || newsFailed.current.has(key)) return;
    setNewsLoading((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(`/api/local-news?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&venue=${encodeURIComponent(venue)}`);
      if (res.ok) {
        const data = await res.json();
        setLocalNews((prev) => ({ ...prev, [key]: data.news }));
      } else {
        newsFailed.current.add(key);
      }
    } catch {
      newsFailed.current.add(key);
    } finally {
      setNewsLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [localNews, newsLoading]);

  // Nearby parking state
  interface ParkingSpot { name: string; vicinity: string; lat: number; lng: number; distanceMiles: number; walkMinutes: number; rating: number | null; totalRatings: number; openNow: boolean | null; spotHeroUrl: string; directionsUrl: string }
  const [nearbyParking, setNearbyParking] = useState<Record<string, ParkingSpot[]>>({});
  const [parkingLoading, setParkingLoading] = useState<Set<string>>(new Set());
  const parkingFailed = useRef<Set<string>>(new Set());

  const handleParkingLoad = useCallback(async (venueName: string, venueLat: number, venueLng: number, gameDate: string) => {
    const key = `${venueLat},${venueLng}`;
    if (nearbyParking[key] || parkingLoading.has(key) || parkingFailed.current.has(key)) return;
    setParkingLoading((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(`/api/nearby-parking?venueLat=${venueLat}&venueLng=${venueLng}&venueName=${encodeURIComponent(venueName)}&date=${gameDate}`);
      if (res.ok) {
        const data = await res.json();
        setNearbyParking((prev) => ({ ...prev, [key]: data.parking }));
      } else {
        parkingFailed.current.add(key);
      }
    } catch {
      parkingFailed.current.add(key);
    } finally {
      setParkingLoading((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }, [nearbyParking, parkingLoading]);

  // Last transit home state
  interface LastTransitInfo { stopCode: string; stopName: string; stopLat: number; stopLng: number; lastDeparture: string | null; lastArrival: string | null; durationMinutes: number | null; available: boolean; warning: boolean }
  const [lastTransit, setLastTransit] = useState<Record<string, LastTransitInfo[]>>({});
  const [lastTransitLoading, setLastTransitLoading] = useState<Set<string>>(new Set());
  const lastTransitFailed = useRef<Set<string>>(new Set());

  const handleLastTransitLoad = useCallback(async (venueLat: number, venueLng: number, tipoffUtc: string, stops: { code: string; name: string; lat: number; lng: number }[]) => {
    const key = `${venueLat},${venueLng},${tipoffUtc}`;
    if (stops.length === 0 || lastTransit[key] || lastTransitLoading.has(key) || lastTransitFailed.current.has(key)) return;
    setLastTransitLoading((prev) => new Set(prev).add(key));
    try {
      const stopsParam = encodeURIComponent(JSON.stringify(stops.slice(0, 6)));
      const res = await fetch(`/api/last-transit?venueLat=${venueLat}&venueLng=${venueLng}&tipoffUtc=${encodeURIComponent(tipoffUtc)}&stops=${stopsParam}`);
      if (res.ok) {
        const data = await res.json();
        setLastTransit((prev) => ({ ...prev, [key]: data.lastTransit }));
      } else {
        lastTransitFailed.current.add(key);
      }
    } catch {
      lastTransitFailed.current.add(key);
    } finally {
      setLastTransitLoading((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  }, [lastTransit, lastTransitLoading]);

  // Auto-scroll and expand when a marker is clicked (selectedVenue changes)
  useEffect(() => {
    if (!selectedVenue || trayState === "collapsed") return;
    // Expand the first game at this venue
    const firstGame = games.find((g) => g.venue === selectedVenue);
    if (firstGame) setExpandedCardId(firstGame.id);
    const timer = setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;
      const row = container.querySelector(`[data-venue="${CSS.escape(selectedVenue)}"]`) as HTMLElement | null;
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedVenue, trayState, games]);

  // Scroll to and highlight hovered venue (from map marker hover)
  useEffect(() => {
    if (!hoveredVenue || trayState === "collapsed") return;
    const container = scrollRef.current;
    if (!container) return;
    const row = container.querySelector(`[data-venue="${CSS.escape(hoveredVenue)}"]`) as HTMLElement | null;
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [hoveredVenue, trayState]);

  // Track tray state changes
  useEffect(() => {
    if (prevTrayState.current !== trayState) {
      prevTrayState.current = trayState;
      setIsAnimating(true);
      const timer = setTimeout(() => setIsAnimating(false), 400);
      return () => clearTimeout(timer);
    }
  }, [trayState]);

  const cycleTray = useCallback(() => {
    if (trayState === "collapsed") onTrayStateChange("peek");
    else if (trayState === "peek") onTrayStateChange("expanded");
    else onTrayStateChange("collapsed");
  }, [trayState, onTrayStateChange]);

  const height = trayState === "collapsed" ? "56px" : trayState === "peek" ? "50vh" : "100vh";

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-10 tray-transition pointer-events-auto"
      style={{ height }}
    >
      <div className="h-full panel rounded-t-lg flex flex-col">
        {/* Header bar */}
        <div className="flex items-center select-none border-b border-white/8">
          {/* Search */}
          <div className="flex-1 min-w-0 border-r border-white/5">
            <SearchBar value={search} onChange={onSearchChange} onLocationChange={onLocationChange} />
          </div>
          {/* Filters */}
          <div className="relative shrink-0 border-r border-white/5" ref={filterRef}>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 font-mono text-xs tracking-wider px-3 py-2.5 transition-colors ${
                showFilters || visibleColumns.size < ALL_COLUMNS.length
                  ? "text-[--primary]"
                  : "text-[--color-dim] hover:text-foreground"
              }`}
            >
              <SlidersHorizontal className="size-4" />
            </button>
            {showFilters && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center"
                onClick={(e) => { e.stopPropagation(); setShowFilters(false); }}
              >
                <div
                  className="w-64 rounded-xl border border-white/10 panel-elevated shadow-2xl py-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-4 py-2 text-xs font-mono tracking-widest text-foreground uppercase border-b border-white/8 font-semibold">
                    Columns
                  </div>
                  {ALL_COLUMNS.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => toggleColumn(col.id)}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-mono hover:bg-white/5 transition-all"
                    >
                      <span className={`size-5 rounded-md border-2 flex items-center justify-center transition-all ${
                        visibleColumns.has(col.id)
                          ? "bg-[--primary] border-[--primary] text-white shadow-md shadow-[--primary]/25"
                          : "border-white/25 bg-white/[0.04]"
                      }`}>
                        {visibleColumns.has(col.id) && <Check className="size-3" />}
                      </span>
                      <span className={visibleColumns.has(col.id) ? "text-foreground font-medium" : "text-[--color-dim]"}>
                        {col.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Date selector */}
          <div className="shrink-0">
            <DateSelector
              currentDate={date}
              availableDates={availableDates}
              onDateChange={onDateChange}
              gameCount={games.length}
              gameCountByDate={gameCountByDate}
            />
          </div>
          {/* Expand/collapse */}
          <button
            onClick={cycleTray}
            className="shrink-0 px-2 py-2.5 hover:bg-white/5 transition-colors border-l border-white/5"
          >
            <ChevronUp className={`size-4 text-[--color-dim] transition-transform ${trayState === "expanded" ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Column headers — clickable to sort */}
        {trayState !== "collapsed" && (
          <div className="px-6 py-1.5 border-b border-[--primary]/10 overflow-x-auto no-scrollbar bg-white/[0.02]">
            <div className="flex items-center gap-2.5 text-[9px] font-mono tracking-widest uppercase" style={{ minWidth: visibleColumns.size > 3 ? "600px" : undefined }}>
              {visibleColumns.has("ticket") && (
                <span onClick={() => handleHeaderSort("price")} className={`shrink-0 min-w-[2.5rem] cursor-pointer hover:text-foreground transition-colors ${sortKey === "price" ? "text-[--primary] font-semibold" : "text-[--color-dim]"}`}>
                  TICKET{sortKey === "price" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {visibleColumns.has("record") && (
                <span onClick={() => handleHeaderSort("record")} className={`shrink-0 min-w-[3.2rem] cursor-pointer hover:text-foreground transition-colors ${sortKey === "record" ? "text-[--primary] font-semibold" : "text-[--color-dim]"}`}>
                  REC{sortKey === "record" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {showOdds && visibleColumns.has("odds") && (
                <span onClick={() => handleHeaderSort("odds")} className={`shrink-0 min-w-[2.5rem] cursor-pointer hover:text-foreground transition-colors ${sortKey === "odds" ? "text-[--primary] font-semibold" : "text-[--color-dim]"}`}>
                  ODDS{sortKey === "odds" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {visibleColumns.has("team") && (
                <span onClick={() => handleHeaderSort("team")} className={`flex-1 min-w-0 cursor-pointer hover:text-foreground transition-colors ${sortKey === "team" ? "text-[--primary] font-semibold" : "text-[--color-dim]"}`}>
                  TEAM{sortKey === "team" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {visibleColumns.has("stadium") && (
                <span onClick={() => handleHeaderSort("dist")} className={`flex-1 min-w-0 cursor-pointer hover:text-foreground transition-colors ${sortKey === "dist" ? "text-[--primary] font-semibold" : "text-[--color-dim]"}`}>
                  STADIUM{sortKey === "dist" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {visibleColumns.has("time") && (
                <span onClick={() => handleHeaderSort("time")} className={`shrink-0 cursor-pointer hover:text-foreground transition-colors ${sortKey === "time" ? "text-[--primary] font-semibold" : "text-[--color-dim]"}`}>
                  TIME{sortKey === "time" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Scrollable game cards */}
        {trayState !== "collapsed" && (
          <div ref={scrollRef} className={`flex-1 overflow-y-auto no-scrollbar px-3 pb-3 space-y-2 ${isAnimating ? "pointer-events-none" : ""}`}>
            {games.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <span className="text-[--color-dim] text-sm font-mono">NO GAMES AVAILABLE</span>
                <span className="text-[--color-dim]/60 text-xs font-mono">Try a different date</span>
              </div>
            )}
            {sortedGames.map((event) => {
              const parts = event.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
              const home = parts[0].replace(/\s*\(.*?\)/g, "").trim();
              const away = parts.length > 1 ? parts.slice(1).join(" vs ").replace(/\s*\(.*?\)/g, "").trim() : null;
              const isRampageSelected = rampage.active && event.est_date && rampage.selectedGames.has(event.est_date) && rampage.selectedGames.get(event.est_date)!.id === event.id;
              const isSelected = !rampage.active && selectedVenue === event.venue;
              const isHovered = hoveredVenue === event.venue;
              const isExpanded = !rampage.active && expandedCardId === event.id;
              const airports = event.nearbyAirports ?? [];
              const trains = event.nearbyTrainStations ?? [];
              const buses = event.nearbyBusStations ?? [];
              const kalshiUrl = event.odds
                ? `https://kalshi.com/markets/KXNBAGAME/${event.odds.kalshi_event}`
                : null;
              const price = event.espn_price?.amount ?? event.min_price?.amount;
              const dist = distanceMap[event.id];
              const spread = event.odds ? Math.abs(event.odds.away_win - event.odds.home_win) : null;
              const isCloseOdds = spread != null && spread <= 10;
              const isCloseMatchup = (() => {
                if (!event.away_record || !event.home_record) return false;
                const pa = event.away_record.split("-").map(Number);
                const ph = event.home_record.split("-").map(Number);
                if (pa.length < 2 || ph.length < 2) return false;
                const tA = pa[0] + pa[1];
                const tH = ph[0] + ph[1];
                if (tA === 0 || tH === 0) return false;
                return Math.abs(pa[0] / tA - ph[0] / tH) <= 0.05;
              })();

              return (
                <div
                  key={event.id}
                  data-venue={event.venue}
                  onMouseEnter={() => onVenueHover?.(event.venue)}
                  onMouseLeave={() => onVenueHover?.(null)}
                  className={`rounded-lg card-enter transition-all cursor-pointer ${
                    isRampageSelected
                      ? "border-l-2 border-[--color-rampage] bg-[--color-rampage]/8 shadow-lg shadow-[--color-rampage]/5"
                      : isSelected || isHovered
                        ? "shadow-lg"
                        : "hover:bg-white/[0.04]"
                  }`}
                  style={isHovered && !isSelected && !isRampageSelected ? { borderColor: "white" } : undefined}
                  onClick={() => {
                    // RAMPAGE mode: toggle game selection
                    if (rampage.active && event.lat != null && event.lng != null && event.est_date) {
                      const wasSelected = rampage.selectedGames.has(event.est_date) && rampage.selectedGames.get(event.est_date)!.id === event.id;
                      rampage.toggleGame({
                        id: event.id,
                        name: event.name,
                        venue: event.venue,
                        city: event.city,
                        state: event.state,
                        lat: event.lat!,
                        lng: event.lng!,
                        est_date: event.est_date,
                        est_time: event.est_time,
                        local_time: event.local_time,
                        tz: event.tz,
                        date_time_utc: event.date_time_utc,
                        min_price: event.min_price,
                        espn_price: event.espn_price,
                        odds: event.odds,
                        away_record: event.away_record,
                        home_record: event.home_record,
                      });
                      // When selecting: set location to stadium for accurate distances on next date
                      if (!wasSelected) {
                        onLocationChange({ lat: event.lat!, lng: event.lng! });
                        const idx = availableDates.indexOf(date);
                        if (idx >= 0 && idx < availableDates.length - 1) {
                          setTimeout(() => onDateChange(availableDates[idx + 1]), 300);
                        }
                      }
                      return;
                    }
                    // Normal mode: venue focus
                    if (event.lat != null && event.lng != null) {
                      const vLat = event.lat!;
                      const vLng = event.lng!;
                      for (const s of [...airports, ...trains, ...buses]) {
                        handleEnrich(vLat, vLng, s, event.date_time_utc);
                      }
                      handlePolicyLoad(event.venue);
                      handleWeatherLoad(vLat, vLng, event.est_date || date);
                      const aptCodes = (event.nearbyAirports ?? []).map((a) => a.code);
                      if (aptCodes.length > 0) handleDelaysLoad(aptCodes);
                      handleNewsLoad(event.city, event.state, event.venue);
                      handleParkingLoad(event.venue, vLat, vLng, event.est_date || date);
                      if (event.date_time_utc) {
                        const transitStops = [
                          ...(event.nearbyTrainStations ?? []).map((s) => ({ code: s.code, name: s.name, lat: s.lat, lng: s.lng })),
                          ...(event.nearbyBusStations ?? []).map((s) => ({ code: s.code, name: s.name, lat: s.lat, lng: s.lng })),
                        ];
                        handleLastTransitLoad(vLat, vLng, event.date_time_utc, transitStops);
                      }
                      handleHotelsLoad(event.venue, vLat, vLng, event.est_date || date);
                      const venueGames = games.filter((g) => g.venue === event.venue);
                      onVenueClick({
                        venue: event.venue,
                        city: event.city,
                        state: event.state,
                        lat: vLat,
                        lng: vLng,
                        games: venueGames.map((g) => ({
                          id: g.id,
                          name: g.name,
                          url: g.url,
                          est_time: g.est_time,
                          local_time: g.local_time,
                          tz: g.tz,
                          date_time_utc: g.date_time_utc,
                          min_price: g.min_price,
                          odds: g.odds,
                          away_record: g.away_record,
                          home_record: g.home_record,
                        })),
                        airports: event.nearbyAirports ?? [],
                        trains: event.nearbyTrainStations ?? [],
                        buses: event.nearbyBusStations ?? [],
                      });
                    }
                    if (popoverEventId !== event.id) {
                      openPopover(event.id);
                    } else {
                      closePopover();
                    }
                  }}
                >
                  {/* Card header — always visible */}
                  <div className={`px-3 py-2.5 overflow-x-auto no-scrollbar ${isHovered && !isRampageSelected ? "font-bold" : ""}`}>
                    <div className="flex items-start gap-2.5" style={{ minWidth: visibleColumns.size > 3 ? "600px" : undefined }}>
                      {/* Rampage selection indicator */}
                      {rampage.active && (
                        <div className="shrink-0 flex items-center pt-0.5">
                          {isRampageSelected ? (
                            <CheckCircle2 className="size-5 text-[--color-rampage]" />
                          ) : (
                            <Circle className="size-5 text-[--color-dim]" />
                          )}
                        </div>
                      )}
                      {/* Col: Ticket */}
                      {visibleColumns.has("ticket") && (
                        <div className="flex flex-col items-start shrink-0 gap-0.5 min-w-[2.5rem]">
                          {price != null && (
                            <span className={`font-mono text-sm font-semibold ${price < 30 ? "text-emerald-400" : price < 80 ? "text-emerald-300/80" : "text-foreground"}`}>${price}</span>
                          )}
                          {event.espn_price?.available != null && event.espn_price.available > 0 && (
                            <span className={`font-mono text-[10px] ${event.espn_price.available < 1000 ? "text-[#facc15]" : "text-[--color-dim]"}`}>{event.espn_price.available}<br/>available</span>
                          )}
                        </div>
                      )}
                      {/* Col: Records */}
                      {visibleColumns.has("record") && (
                        <div className="flex flex-col items-start shrink-0 gap-0.5 min-w-[3.2rem]">
                          {away ? (
                            <>
                              <span className={`font-mono text-xs tabular-nums ${isCloseMatchup ? "text-[#facc15]" : "text-[--color-dim]"}`}>{event.away_record || "—"}</span>
                              <span className={`font-mono text-xs tabular-nums ${isCloseMatchup ? "text-[#facc15]" : "text-[--color-dim]"}`}>{event.home_record || "—"}</span>
                            </>
                          ) : <span className="text-xs">&nbsp;</span>}
                        </div>
                      )}
                      {/* Col: Odds + spread */}
                      {showOdds && visibleColumns.has("odds") && (
                        <div className="flex flex-col items-start shrink-0 gap-0.5 min-w-[2.5rem]">
                          {away && event.odds ? (
                            <>
                              <span className={`font-mono text-xs tabular-nums ${isCloseOdds ? "text-[#facc15] font-semibold" : "text-[--color-dim]"}`}>{event.odds.away_win}%</span>
                              <span className={`font-mono text-xs tabular-nums ${isCloseOdds ? "text-[#facc15] font-semibold" : "text-[--color-dim]"}`}>{event.odds.home_win}%</span>
                              <span className={`font-mono text-[10px] ${isCloseOdds ? "text-[#facc15]" : "text-[--color-dim]"}`}>±{spread}</span>
                            </>
                          ) : <span className="text-xs">&nbsp;</span>}
                        </div>
                      )}
                      {/* Col: Team */}
                      {visibleColumns.has("team") && (
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          {away ? (
                            <>
                              <span className="text-sm font-semibold uppercase text-foreground truncate">{away}</span>
                              <span className="text-sm font-semibold uppercase text-foreground truncate"><span className="text-[--primary]/60 font-normal mr-1">@</span>{home}</span>
                            </>
                          ) : (
                            <span className="text-sm font-semibold uppercase text-foreground truncate">{event.name}</span>
                          )}
                        </div>
                      )}
                      {/* Col: Stadium */}
                      {visibleColumns.has("stadium") && (
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="text-[11px] text-[--color-dim] font-mono truncate">{event.venue}</span>
                          <span className={`text-[10px] font-mono truncate ${dist != null && dist < 250 ? "text-[#facc15]" : "text-[--color-dim]"}`}>{event.city}, {event.state}{dist != null ? ` · ${Math.round(dist)}mi` : ""}</span>
                        </div>
                      )}
                      {/* Col: Time */}
                      {visibleColumns.has("time") && (() => {
                        const userLocal = formatUserLocalTime(event.date_time_utc);
                        const showLocal = userLocal && userLocal.tz !== (event.tz ?? "ET");
                        return (
                          <div className="shrink-0 text-right">
                            <span className="font-mono text-sm text-foreground">{formatTime(event.local_time ?? event.est_time, event.tz)}</span>
                            {showLocal && (
                              <div className="font-mono text-[10px] text-[--color-dim]">{userLocal.text} {userLocal.tz}</div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Card no longer expands inline — popover renders via portal */}
                </div>
              );
            })}
          </div>
        )}

        {/* Full-page venue popover */}
        {popoverEventId && (() => {
          const event = games.find((g) => g.id === popoverEventId);
          if (!event || !event.lat || !event.lng) return null;
          const parts = event.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
          const home = parts[0].replace(/\s*\(.*?\)/g, "").trim();
          const away = parts.length > 1 ? parts.slice(1).join(" vs ").replace(/\s*\(.*?\)/g, "").trim() : null;
          const airports = event.nearbyAirports ?? [];
          const trains = event.nearbyTrainStations ?? [];
          const buses = event.nearbyBusStations ?? [];
          const kalshiUrl = event.odds ? `https://kalshi.com/markets/KXNBAGAME/${event.odds.kalshi_event}` : null;
          const price = event.espn_price?.amount ?? event.min_price?.amount;
          const dist = distanceMap[event.id];
          const userLocal = formatUserLocalTime(event.date_time_utc);
          const showLocal = userLocal && userLocal.tz !== (event.tz ?? "ET");

          return createPortal(
            <div
              className={`fixed inset-0 z-50 transition-opacity duration-300 ${popoverVisible ? "opacity-100" : "opacity-0"}`}
              onClick={closePopover}
            >
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

              {/* Panel */}
              <div
                className={`absolute inset-0 bg-[--background] overflow-hidden flex flex-col transition-transform duration-300 ease-out ${popoverVisible ? "translate-y-0" : "translate-y-full"}`}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Drag handle + close */}
                <div className="sticky top-0 z-10 bg-[--background] border-b border-white/5">
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full bg-white/20" />
                  </div>
                  <div className="flex items-center justify-between px-5 pb-3">
                    <div>
                      {away ? (
                        <h2 className="text-lg font-bold uppercase tracking-tight text-foreground">
                          {away} <span className="text-[--primary]/60 font-normal">@</span> {home}
                        </h2>
                      ) : (
                        <h2 className="text-lg font-bold uppercase tracking-tight text-foreground">{event.name}</h2>
                      )}
                      <div className="flex items-center gap-3 mt-0.5 text-sm text-[--color-dim] font-mono">
                        <span>{event.venue}</span>
                        <span>{event.city}, {event.state}</span>
                        {dist != null && <span>{Math.round(dist)}mi away</span>}
                      </div>
                    </div>
                    <button onClick={closePopover} className="p-2 rounded-full hover:bg-white/10 transition-colors">
                      <X className="size-5 text-[--color-dim]" />
                    </button>
                  </div>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-8">
                  {/* Hero stats grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-5 border-b border-white/5">
                    <div className="bg-white/5 rounded-xl p-3">
                      <div className="text-[10px] font-mono text-[--color-dim] uppercase tracking-widest mb-1">Tipoff</div>
                      <div className="text-xl font-bold font-mono text-foreground">{formatTime(event.local_time ?? event.est_time, event.tz)}</div>
                      {showLocal && <div className="text-xs font-mono text-[--color-dim] mt-0.5">{userLocal.text} your time</div>}
                    </div>
                    {price != null && (
                      <div className="bg-white/5 rounded-xl p-3">
                        <div className="text-[10px] font-mono text-[--color-dim] uppercase tracking-widest mb-1">From</div>
                        <div className={`text-xl font-bold font-mono ${price < 30 ? "text-emerald-400" : price < 80 ? "text-emerald-300/80" : "text-foreground"}`}>${price}</div>
                        {event.espn_price?.available != null && event.espn_price.available > 0 && (
                          <div className={`text-xs font-mono mt-0.5 ${event.espn_price.available < 1000 ? "text-[#facc15]" : "text-[--color-dim]"}`}>{event.espn_price.available} left</div>
                        )}
                      </div>
                    )}
                    {event.odds && away && (
                      <div className="bg-white/5 rounded-xl p-3">
                        <div className="text-[10px] font-mono text-[--color-dim] uppercase tracking-widest mb-1">Win Probability</div>
                        <div className="space-y-1 mt-1">
                          <div className="flex items-center justify-between text-xs font-mono">
                            <span className="text-[--color-dim]">{away}</span>
                            <span className="text-foreground font-bold">{event.odds.away_win}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-[--primary]" style={{ width: `${event.odds.away_win}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-xs font-mono">
                            <span className="text-[--color-dim]">{home}</span>
                            <span className="text-foreground font-bold">{event.odds.home_win}%</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {event.away_record && event.home_record && away && (
                      <div className="bg-white/5 rounded-xl p-3">
                        <div className="text-[10px] font-mono text-[--color-dim] uppercase tracking-widest mb-1">Season Record</div>
                        <div className="space-y-1 mt-1">
                          <div className="flex items-center justify-between text-xs font-mono">
                            <span className="text-[--color-dim]">{away}</span>
                            <span className="text-foreground font-bold tabular-nums">{event.away_record}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs font-mono">
                            <span className="text-[--color-dim]">{home}</span>
                            <span className="text-foreground font-bold tabular-nums">{event.home_record}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section: Weather */}
                  {(() => {
                    const weatherKey = `${event.lat},${event.lng},${event.est_date || date}`;
                    const hours = weather[weatherKey];
                    const wLoading = weatherLoading.has(weatherKey);
                    if (!hours && !wLoading) return null;
                    const relevantHours = hours ?? [];
                    return (
                      <div className="py-5 border-b border-white/5">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] mb-3 flex items-center gap-2"><Thermometer className="size-4" /> Game Day Weather</h3>
                        {wLoading && !hours && <div className="flex items-center gap-2 text-sm text-[--color-dim]"><Loader2 className="size-4 animate-spin" /> Loading weather...</div>}
                        {relevantHours.length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                            {relevantHours.map((h) => {
                              const hr = parseInt(h.time.split("T")[1]?.split(":")[0] ?? "0");
                              const ampm = hr >= 12 ? "PM" : "AM";
                              const hr12 = hr % 12 || 12;
                              const tipoffHr = event.date_time_utc ? new Date(event.date_time_utc).getHours() : -1;
                              const isTipoff = hr === tipoffHr;
                              return (
                                <div key={h.time} className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[11px] font-mono shrink-0 min-w-[52px] ${isTipoff ? "bg-[--primary]/15 ring-1 ring-[--primary]/30" : "bg-white/5"}`}>
                                  <span className={`font-semibold ${isTipoff ? "text-[--primary]" : "text-[--color-dim]"}`}>{hr12}{ampm}</span>
                                  <WeatherIcon code={h.weatherCode} className="size-4 text-foreground" />
                                  <span className="text-foreground font-bold">{h.temp}°</span>
                                  <span className="text-[--color-dim] text-[9px]">FL {h.feelsLike}°</span>
                                  {h.precipProb > 0 && <span className="text-cyan-400 text-[9px] flex items-center gap-0.5"><Droplets className="size-2" />{h.precipProb}%</span>}
                                  {h.windSpeed >= 10 && <span className="text-amber-400 text-[9px] flex items-center gap-0.5"><Wind className="size-2" />{h.windSpeed}</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Section: Getting There */}
                  {(airports.length > 0 || trains.length > 0 || buses.length > 0) && (
                    <div className="py-5 border-b border-white/5">
                      <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] mb-1 flex items-center gap-2"><Map className="size-4" /> Getting There</h3>
                      <p className="text-[10px] text-[--color-dim]/60 font-mono mb-3">Travel times target arrival 45 min before tipoff</p>
                      <div className="space-y-1">
                        {airports.length > 0 && <TransitRows stops={airports} icon={Plane} vLat={event.lat!} vLng={event.lng!} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop, event.date_time_utc)} onRouteFocus={onRouteFocus} isAnimating={false} venueName={event.venue} colorClass="text-[--color-flight]" tipoffUtc={event.date_time_utc} />}
                        {trains.length > 0 && <TransitRows stops={trains} icon={TrainFront} vLat={event.lat!} vLng={event.lng!} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop, event.date_time_utc)} onRouteFocus={onRouteFocus} isAnimating={false} venueName={event.venue} colorClass="text-[--color-train]" tipoffUtc={event.date_time_utc} />}
                        {buses.length > 0 && <TransitRows stops={buses} icon={BusFront} vLat={event.lat!} vLng={event.lng!} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop, event.date_time_utc)} onRouteFocus={onRouteFocus} isAnimating={false} venueName={event.venue} colorClass="text-[--color-bus]" tipoffUtc={event.date_time_utc} />}
                      </div>
                    </div>
                  )}

                  {/* Section: Airport Status */}
                  {(() => {
                    const aptCodes = airports.map((a) => a.code);
                    const delayKey = aptCodes.sort().join(",");
                    const delays = airportDelays[delayKey];
                    const dLoading = delaysLoading.has(delayKey);
                    if (aptCodes.length === 0 || (!delays && !dLoading)) return null;
                    return (
                      <div className="py-5 border-b border-white/5">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] mb-3 flex items-center gap-2"><Plane className="size-4" /> Airport Status</h3>
                        {dLoading && !delays && <div className="flex items-center gap-2 text-sm text-[--color-dim]"><Loader2 className="size-4 animate-spin" /> Checking delays...</div>}
                        {delays && <div className="space-y-2">{delays.map((d) => {
                          const hasDelay = (d.departureDel != null && d.departureDel > 0) || (d.arrivalDel != null && d.arrivalDel > 0);
                          return (<div key={d.code} className="flex items-center gap-3 text-sm font-mono"><span className="font-bold text-[--color-flight]">{d.code}</span>{hasDelay ? (<div className="flex items-center gap-3 flex-wrap">{d.departureDel != null && d.departureDel > 0 && <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="size-3.5" /> DEP +{d.departureDel}min</span>}{d.arrivalDel != null && d.arrivalDel > 0 && <span className="text-amber-400 flex items-center gap-1"><Clock className="size-3.5" /> ARR +{d.arrivalDel}min</span>}{d.reasons?.map((r, i) => <span key={i} className="text-[--color-dim] text-xs">{r}</span>)}</div>) : <span className="text-emerald-400">No major delays</span>}</div>);
                        })}</div>}
                      </div>
                    );
                  })()}

                  {/* Section: Last Transit Home */}
                  {(() => {
                    if (!event.date_time_utc) return null;
                    const ltKey = `${event.lat},${event.lng},${event.date_time_utc}`;
                    const ltData = lastTransit[ltKey];
                    const ltLoading = lastTransitLoading.has(ltKey);
                    if (!ltData && !ltLoading) return null;
                    return (
                      <div className="py-5 border-b border-white/5">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] mb-3 flex items-center gap-2"><Timer className="size-4" /> Last Transit Home</h3>
                        {ltLoading && !ltData && <div className="flex items-center gap-2 text-sm text-[--color-dim]"><Loader2 className="size-4 animate-spin" /> Checking schedules...</div>}
                        {ltData && ltData.length > 0 && <div className="space-y-2">{ltData.map((lt) => {
                          const depTime = lt.lastDeparture ? new Date(lt.lastDeparture) : null;
                          const depStr = depTime ? depTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : null;
                          return (<div key={lt.stopCode} className="flex items-center gap-3 text-sm font-mono"><span className="font-bold text-[--color-train]">{lt.stopCode}</span>{lt.available && depStr ? (<div className="flex items-center gap-3 flex-wrap"><span className={lt.warning ? "text-red-400 font-semibold" : "text-[--color-dim]"}>Last dep {depStr}</span>{lt.durationMinutes && <span className="text-[--color-dim] text-xs">{lt.durationMinutes}min ride</span>}{lt.warning && <span className="text-red-400 text-xs flex items-center gap-1"><AlertTriangle className="size-3" /> May end before game</span>}</div>) : <span className="text-[--color-dim] text-xs">{lt.available ? "Schedule available" : "No late service found"}</span>}</div>);
                        })}<div className="text-[10px] text-[--color-dim]/60 mt-1">Post-game transit from venue area</div></div>}
                      </div>
                    );
                  })()}

                  {/* Section: Venue Policy */}
                  {(() => {
                    const policy = venuePolicies[event.venue];
                    const loading = policyLoading.has(event.venue);
                    if (!policy && !loading) return null;
                    const allowed = policy?.items.filter((i) => i.allowed) ?? [];
                    const prohibited = policy?.items.filter((i) => !i.allowed) ?? [];
                    return (
                      <div className="py-5 border-b border-white/5">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] mb-3 flex items-center gap-2"><ShieldCheck className="size-4" /> Venue Policy</h3>
                        {loading && !policy && <div className="flex items-center gap-2 text-sm text-[--color-dim]"><Loader2 className="size-4 animate-spin" /> Loading policy...</div>}
                        {policy && (<div>
                          <div className="text-sm font-mono text-[--color-dim] mb-2">{policy.clearBagRequired && <span className="text-amber-400 font-semibold">Clear bag required</span>}{policy.maxBagSize && <span>{policy.clearBagRequired ? " · " : ""}Max {policy.maxBagSize}</span>}</div>
                          <div className="grid grid-cols-2 gap-4 text-sm font-mono">
                            {allowed.length > 0 && <div className="space-y-1">{allowed.map((item) => <div key={item.name} className="flex items-start gap-1.5 text-emerald-400"><Check className="size-4 shrink-0 mt-0.5" /><span>{item.name}</span></div>)}</div>}
                            {prohibited.length > 0 && <div className="space-y-1">{prohibited.map((item) => <div key={item.name} className="flex items-start gap-1.5 text-red-400"><Ban className="size-4 shrink-0 mt-0.5" /><span>{item.name}</span></div>)}</div>}
                          </div>
                          {policy.policyUrl && <a href={policy.policyUrl} target="_blank" rel="noopener noreferrer" className="mt-3 text-xs font-mono text-[--color-dim] hover:text-foreground underline inline-flex items-center gap-1">View full policy <ArrowUpRight className="size-3" /></a>}
                        </div>)}
                      </div>
                    );
                  })()}

                  {/* Section: Hotels */}
                  {(() => {
                    const hotels = nearbyHotels[event.venue];
                    const loading = hotelsLoading.has(event.venue);
                    if (!hotels && !loading) return null;
                    const arriveByEpoch = event.date_time_utc ? Math.floor((new Date(event.date_time_utc).getTime() - 45 * 60 * 1000) / 1000) : undefined;
                    return (
                      <div className="py-5 border-b border-white/5">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] mb-3 flex items-center gap-2"><Hotel className="size-4" /> Nearby Hotels</h3>
                        {loading && !hotels && <div className="flex items-center gap-2 text-sm text-[--color-dim]"><Loader2 className="size-4 animate-spin" /> Loading hotels...</div>}
                        {hotels && hotels.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{hotels.map((h, hi) => (
                          <div key={hi} className="rounded-xl bg-white/5 p-3 space-y-2">
                            <a href={h.bookingUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-foreground hover:text-amber-400 transition-colors no-underline block truncate">{h.name}</a>
                            <div className="flex items-center gap-3 text-xs font-mono">
                              {h.rating && <span className="flex items-center gap-0.5 text-amber-400"><Star className="size-3" /> {h.rating}</span>}
                              <span className="text-emerald-400">{h.estimatedPrice}</span>
                              <span className="text-[--color-dim] flex items-center gap-0.5"><MapPin className="size-3" /> {h.distanceMiles}mi</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs font-mono text-[--color-dim] flex-wrap">
                              <a href={gmapsUrl(h.lat, h.lng, event.lat!, event.lng!, "driving", arriveByEpoch)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground no-underline flex items-center gap-1"><Car className="size-3" />{h.driveMinutes}min</a>
                              {h.transitMinutes != null && <a href={gmapsUrl(h.lat, h.lng, event.lat!, event.lng!, "transit", arriveByEpoch)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground no-underline flex items-center gap-1"><Bus className="size-3" />{h.transitMinutes}min{h.transitFare && <span className="text-emerald-400 ml-0.5">{h.transitFare}</span>}</a>}
                              <span className="flex items-center gap-1"><Footprints className="size-3" />{h.walkMinutes}min</span>
                              <span>UBER <span className="text-emerald-400">{h.uberEstimate}</span></span>
                              <span>LYFT <span className="text-emerald-400">{h.lyftEstimate}</span></span>
                            </div>
                          </div>
                        ))}</div>}
                      </div>
                    );
                  })()}

                  {/* Section: Parking */}
                  {(() => {
                    const parkKey = `${event.lat},${event.lng}`;
                    const spots = nearbyParking[parkKey];
                    const pLoading = parkingLoading.has(parkKey);
                    if (!spots && !pLoading) return null;
                    return (
                      <div className="py-5 border-b border-white/5">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] flex items-center gap-2"><ParkingSquare className="size-4" /> Parking</h3>
                          {spots && spots.length > 0 && <a href={spots[0].spotHeroUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 no-underline flex items-center gap-1">Reserve on SpotHero <ExternalLink className="size-3" /></a>}
                        </div>
                        {pLoading && !spots && <div className="flex items-center gap-2 text-sm text-[--color-dim]"><Loader2 className="size-4 animate-spin" /> Finding parking...</div>}
                        {spots && spots.length > 0 && <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{spots.map((p, i) => (
                          <a key={i} href={p.directionsUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white/5 hover:bg-white/10 transition-colors p-2.5 no-underline block">
                            <div className="text-xs font-mono text-foreground font-semibold truncate">{p.name}</div>
                            <div className="flex items-center gap-2 text-[10px] text-[--color-dim] mt-1 font-mono">
                              <span className="flex items-center gap-0.5"><MapPin className="size-2.5 text-amber-400/60" />{p.distanceMiles}mi</span>
                              <span><Footprints className="size-2.5 inline" /> {p.walkMinutes}min</span>
                              {p.rating && <span className="text-amber-400"><Star className="size-2.5 inline" /> {p.rating}</span>}
                              {p.openNow != null && <span className={p.openNow ? "text-emerald-400" : "text-red-400"}>{p.openNow ? "Open" : "Closed"}</span>}
                            </div>
                          </a>
                        ))}</div>}
                        {spots && spots.length === 0 && <div className="text-sm text-[--color-dim] font-mono">No parking found nearby</div>}
                      </div>
                    );
                  })()}

                  {/* Section: Local News */}
                  {(() => {
                    const newsKey = `${event.city},${event.state}`;
                    const news = localNews[newsKey];
                    const nLoading = newsLoading.has(newsKey);
                    if (!news && !nLoading) return null;
                    return (
                      <div className="py-5 border-b border-white/5">
                        <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] mb-3 flex items-center gap-2"><Newspaper className="size-4" /> Local News</h3>
                        {nLoading && !news && <div className="flex items-center gap-2 text-sm text-[--color-dim]"><Loader2 className="size-4 animate-spin" /> Loading news...</div>}
                        {news && news.length > 0 && <div className="space-y-2">{news.map((n, i) => (
                          <a key={i} href={n.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg hover:bg-white/5 px-3 py-2 no-underline transition-colors">
                            <div className="text-sm text-foreground leading-snug">{n.title}</div>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-[--color-dim] font-mono">
                              <span>{n.source}</span>
                              {n.published && <span>{new Date(n.published).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                              <ExternalLink className="size-2.5 ml-auto" />
                            </div>
                          </a>
                        ))}</div>}
                        {news && news.length === 0 && <div className="text-sm text-[--color-dim] font-mono">No recent news found</div>}
                      </div>
                    );
                  })()}

                  {/* Section: Links */}
                  <div className="py-5 border-b border-white/5">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-[--color-dim] mb-3 flex items-center gap-2"><Ticket className="size-4" /> Tickets & Links</h3>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Ticketmaster", href: event.url },
                        away ? { label: "StubHub", href: stubhubUrl(home) } : null,
                        event.espn_price?.url ? { label: "VividSeats", href: event.espn_price.url } : null,
                        kalshiUrl ? { label: "Kalshi", href: kalshiUrl } : null,
                        { label: "ESPN", href: `https://www.espn.com/nba/scoreboard/_/date/${date.replace(/-/g, "")}` },
                        venuePolicies[event.venue]?.websiteUrl ? { label: "Venue", href: venuePolicies[event.venue].websiteUrl } : null,
                      ].filter(Boolean).map((link) => (
                        <a key={link!.label} href={link!.href} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-mono text-[--color-dim] hover:text-foreground no-underline transition-colors inline-flex items-center gap-1">
                          {link!.label} <ArrowUpRight className="size-3" />
                        </a>
                      ))}
                    </div>
                  </div>

                  {/* Take Me CTA */}
                  <div className="py-6">
                    {userLocation && event.est_time ? (
                      <button
                        onClick={() => {
                          const id = crypto.randomUUID().slice(0, 8);
                          const cow = {
                            id, createdAt: new Date().toISOString(),
                            startLocation: { lat: userLocation.lat, lng: userLocation.lng, label: "Current Location" },
                            endLocation: { lat: userLocation.lat, lng: userLocation.lng, label: "Current Location" },
                            games: [{ id: event.id, name: event.name, venue: event.venue, city: event.city, state: event.state, lat: event.lat!, lng: event.lng!, est_date: event.est_date || date, est_time: event.est_time, local_time: event.local_time, tz: event.tz, date_time_utc: event.date_time_utc, min_price: event.min_price, espn_price: event.espn_price, odds: event.odds, away_record: event.away_record, home_record: event.home_record }],
                          };
                          localStorage.setItem(`balltastic_cow_${id}`, JSON.stringify(cow));
                          fetch("/api/cow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, data: cow }) }).catch(() => {});
                          router.push(`/rampage?cow=${id}`);
                        }}
                        className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-mono text-base font-semibold tracking-wider bg-[--primary] text-[--primary-foreground] shadow-lg hover:brightness-110 transition-all press-scale"
                      >
                        <Navigation className="size-5" /> RUN IT!
                      </button>
                    ) : (
                      <div className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-mono text-sm text-[--color-dim] bg-white/[0.03] border border-white/5">
                        SET LOCATION TO PLAN ROUTE
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          );
        })()}
      </div>
    </div>
  );
}
