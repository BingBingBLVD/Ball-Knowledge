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
            className="rounded-xl bg-neutral-50 p-4"
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
                      <Car className="size-4 text-neutral-400" />
                      <span className="text-xs font-bold text-neutral-900">{formatDriveTime(times.driveMinutes)}</span>
                      <span className="text-[10px] text-neutral-500">Drive</span>
                    </div>
                    <div className="text-[10px] text-emerald-600 mt-1">
                      <span className="cursor-pointer hover:underline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(uberDeepLink(vLat, vLng, stop.lat, stop.lng), "_blank"); }}>Uber {times.uberEstimate ? `~${extractUpperBound(times.uberEstimate)}` : "--"}</span>
                      <span className="text-neutral-300 mx-1">·</span>
                      <span className="cursor-pointer hover:underline" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(lyftDeepLink(vLat, vLng, stop.lat, stop.lng), "_blank"); }}>Lyft {times.lyftEstimate ? `~${extractUpperBound(times.lyftEstimate)}` : "--"}</span>
                    </div>
                  </a>
                  <div className="rounded-lg overflow-hidden border border-black/5">
                    <iframe
                      className="w-full h-[180px]"
                      style={{ colorScheme: "light" }}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      src={`https://www.google.com/maps/embed/v1/directions?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&origin=${stop.lat},${stop.lng}&destination=${vLat},${vLng}&mode=driving&zoom=10`}
                    />
                  </div>
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
                    <div className="rounded-lg overflow-hidden border border-black/5">
                      <iframe
                        className="w-full h-[180px]"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        src={`https://www.google.com/maps/embed/v1/directions?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&origin=${stop.lat},${stop.lng}&destination=${vLat},${vLng}&mode=transit&zoom=10`}
                      />
                    </div>
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
  const [transitTab, setTransitTab] = useState<"flights" | "trains" | "buses">("flights");

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

  // Venue photos state
  const [venuePhotos, setVenuePhotos] = useState<Record<string, string[]>>({});
  const [photosLoading, setPhotosLoading] = useState<Set<string>>(new Set());
  const photosFailed = useRef<Set<string>>(new Set());

  const handlePhotosLoad = useCallback(async (venue: string, lat: number, lng: number) => {
    if (venuePhotos[venue] || photosLoading.has(venue) || photosFailed.current.has(venue)) return;
    setPhotosLoading((prev) => new Set(prev).add(venue));
    try {
      const res = await fetch(`/api/venue-photos?venue=${encodeURIComponent(venue)}&lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const data = await res.json();
        setVenuePhotos((prev) => ({ ...prev, [venue]: data.photos }));
      } else {
        photosFailed.current.add(venue);
      }
    } catch {
      photosFailed.current.add(venue);
    } finally {
      setPhotosLoading((prev) => { const next = new Set(prev); next.delete(venue); return next; });
    }
  }, [venuePhotos, photosLoading]);

  // Nearby parking state
  interface ParkingSpot { name: string; vicinity: string; lat: number; lng: number; distanceMiles: number; walkMinutes: number; rating: number | null; totalRatings: number; openNow: boolean | null; priceLevel: string | null; estimatedPrice: string | null; photoUrl: string | null; spotHeroUrl: string; directionsUrl: string }
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
        <div className="flex items-center select-none border-b border-black/5">
          {/* Search */}
          <div className="flex-1 min-w-0 border-r border-black/5">
            <SearchBar value={search} onChange={onSearchChange} onLocationChange={onLocationChange} />
          </div>
          {/* Filters */}
          <div className="relative shrink-0 border-r border-black/5" ref={filterRef}>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 text-xs tracking-wider px-3 py-2.5 transition-colors ${
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
                  className="w-64 rounded-xl border border-black/8 panel-elevated shadow-2xl py-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-4 py-2 text-xs tracking-widest text-foreground uppercase border-b border-black/5 font-semibold">
                    Columns
                  </div>
                  {ALL_COLUMNS.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => toggleColumn(col.id)}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-black/5 transition-all"
                    >
                      <span className={`size-5 rounded-md border-2 flex items-center justify-center transition-all ${
                        visibleColumns.has(col.id)
                          ? "bg-[--primary] border-[--primary] text-white shadow-md shadow-[--primary]/25"
                          : "border-black/15 bg-black/[0.03]"
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
            className="shrink-0 px-2 py-2.5 hover:bg-black/5 transition-colors border-l border-black/5"
          >
            <ChevronUp className={`size-4 text-[--color-dim] transition-transform ${trayState === "expanded" ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Column headers — clickable to sort */}
        {trayState !== "collapsed" && (
          <div className="px-6 py-1.5 border-b border-[--primary]/10 overflow-x-auto no-scrollbar bg-black/[0.02]">
            <div className="flex items-center gap-2.5 text-[9px] font-semibold tracking-widest uppercase" style={{ minWidth: visibleColumns.size > 3 ? "600px" : undefined }}>
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
                <span className="text-[--color-dim] text-sm">NO GAMES AVAILABLE</span>
                <span className="text-[--color-dim]/60 text-xs">Try a different date</span>
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
                        : "hover:bg-black/[0.03]"
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
                      handlePhotosLoad(event.venue, vLat, vLng);
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
                      // Auto-select first available transit tab
                      if ((event.nearbyAirports ?? []).length > 0) setTransitTab("flights");
                      else if ((event.nearbyTrainStations ?? []).length > 0) setTransitTab("trains");
                      else if ((event.nearbyBusStations ?? []).length > 0) setTransitTab("buses");
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
                            <span className={`text-sm font-semibold ${price < 30 ? "text-emerald-600" : price < 80 ? "text-emerald-700" : "text-foreground"}`}>${price}</span>
                          )}
                          {event.espn_price?.available != null && event.espn_price.available > 0 && (
                            <span className={`text-[10px] ${event.espn_price.available < 1000 ? "text-amber-600" : "text-[--color-dim]"}`}>{event.espn_price.available}<br/>available</span>
                          )}
                        </div>
                      )}
                      {/* Col: Records */}
                      {visibleColumns.has("record") && (
                        <div className="flex flex-col items-start shrink-0 gap-0.5 min-w-[3.2rem]">
                          {away ? (
                            <>
                              <span className={`text-xs tabular-nums ${isCloseMatchup ? "text-amber-600" : "text-[--color-dim]"}`}>{event.away_record || "—"}</span>
                              <span className={`text-xs tabular-nums ${isCloseMatchup ? "text-amber-600" : "text-[--color-dim]"}`}>{event.home_record || "—"}</span>
                            </>
                          ) : <span className="text-xs">&nbsp;</span>}
                        </div>
                      )}
                      {/* Col: Odds + spread */}
                      {showOdds && visibleColumns.has("odds") && (
                        <div className="flex flex-col items-start shrink-0 gap-0.5 min-w-[2.5rem]">
                          {away && event.odds ? (
                            <>
                              <span className={`text-xs tabular-nums ${isCloseOdds ? "text-amber-600 font-semibold" : "text-[--color-dim]"}`}>{event.odds.away_win}%</span>
                              <span className={`text-xs tabular-nums ${isCloseOdds ? "text-amber-600 font-semibold" : "text-[--color-dim]"}`}>{event.odds.home_win}%</span>
                              <span className={`text-[10px] ${isCloseOdds ? "text-amber-600" : "text-[--color-dim]"}`}>±{spread}</span>
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
                          <span className="text-[11px] text-[--color-dim] truncate">{event.venue}</span>
                          <span className={`text-[10px] truncate ${dist != null && dist < 250 ? "text-amber-600" : "text-[--color-dim]"}`}>{event.city}, {event.state}{dist != null ? ` · ${Math.round(dist)}mi` : ""}</span>
                        </div>
                      )}
                      {/* Col: Time */}
                      {visibleColumns.has("time") && (() => {
                        const userLocal = formatUserLocalTime(event.date_time_utc);
                        const showLocal = userLocal && userLocal.tz !== (event.tz ?? "ET");
                        return (
                          <div className="shrink-0 text-right">
                            <span className="text-sm text-foreground">{formatTime(event.local_time ?? event.est_time, event.tz)}</span>
                            {showLocal && (
                              <div className="text-[10px] text-[--color-dim]">{userLocal.text} {userLocal.tz}</div>
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
              <div className="absolute inset-0 bg-white/70 backdrop-blur-md" />

              <div
                className={`absolute inset-0 bg-white overflow-hidden flex flex-col transition-transform duration-300 ease-out ${popoverVisible ? "translate-y-0" : "translate-y-full"}`}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Sticky header — Airbnb style */}
                <div className="sticky top-0 z-10 bg-white border-b border-neutral-200">
                  <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
                    <button onClick={closePopover} className="p-2 -ml-2 rounded-full hover:bg-neutral-100 transition-colors">
                      <X className="size-5 text-neutral-600" />
                    </button>
                    <div className="flex items-center gap-3">
                      {price != null && <span className="text-sm font-semibold">From ${price}</span>}
                      <button
                        onClick={() => {
                          if (!userLocation || !event.est_time) return;
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
                        disabled={!userLocation || !event.est_time}
                        className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        RUN IT!
                      </button>
                    </div>
                  </div>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto no-scrollbar">
                  <div className="max-w-3xl mx-auto px-6">
                    {/* Venue photos — Airbnb grid */}
                    {(() => {
                      const photos = venuePhotos[event.venue];
                      if (!photos || photos.length === 0) return null;
                      return (
                        <div className="rounded-xl overflow-hidden mt-6 mb-2">
                          {photos.length >= 5 ? (
                            <div className="grid grid-cols-4 grid-rows-2 gap-1.5 h-[320px]">
                              <div className="col-span-2 row-span-2 relative">
                                <img src={photos[0]} alt={event.venue} className="w-full h-full object-cover rounded-l-xl" />
                              </div>
                              <div className="relative"><img src={photos[1]} alt="" className="w-full h-full object-cover" /></div>
                              <div className="relative"><img src={photos[2]} alt="" className="w-full h-full object-cover rounded-tr-xl" /></div>
                              <div className="relative"><img src={photos[3]} alt="" className="w-full h-full object-cover" /></div>
                              <div className="relative"><img src={photos[4]} alt="" className="w-full h-full object-cover rounded-br-xl" /></div>
                            </div>
                          ) : photos.length >= 3 ? (
                            <div className="grid grid-cols-3 gap-1.5 h-[240px]">
                              <div className="col-span-2 relative"><img src={photos[0]} alt={event.venue} className="w-full h-full object-cover rounded-l-xl" /></div>
                              <div className="flex flex-col gap-1.5">
                                <div className="flex-1 relative"><img src={photos[1]} alt="" className="w-full h-full object-cover rounded-tr-xl" /></div>
                                <div className="flex-1 relative"><img src={photos[2]} alt="" className="w-full h-full object-cover rounded-br-xl" /></div>
                              </div>
                            </div>
                          ) : (
                            <div className="h-[240px]">
                              <img src={photos[0]} alt={event.venue} className="w-full h-full object-cover rounded-xl" />
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Title section */}
                    <div className="pt-8 pb-6">
                      {away ? (
                        <h1 className="text-[26px] font-bold text-neutral-900 leading-tight">
                          {away} <span className="text-neutral-400 font-normal">@</span> {home}
                        </h1>
                      ) : (
                        <h1 className="text-[26px] font-bold text-neutral-900 leading-tight">{event.name}</h1>
                      )}
                      <div className="flex items-center gap-1 mt-2 text-sm text-neutral-500">
                        <span>{event.venue}</span>
                        <span className="text-neutral-300">·</span>
                        <span>{event.city}, {event.state}</span>
                        {dist != null && <><span className="text-neutral-300">·</span><span>{Math.round(dist)} miles away</span></>}
                      </div>
                    </div>

                    {/* Key details row */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-6 border-b border-neutral-200">
                      <div className="flex items-center gap-2">
                        <Clock className="size-5 text-neutral-400" />
                        <div>
                          <div className="text-sm font-semibold text-neutral-900">{formatTime(event.local_time ?? event.est_time, event.tz)}</div>
                          <div className="text-xs text-neutral-500">{event.est_date ? new Date(event.est_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : date}</div>
                          {showLocal && <div className="text-xs text-neutral-500">{userLocal.text} your time</div>}
                        </div>
                      </div>
                      {price != null && (
                        <div className="flex items-center gap-2">
                          <Ticket className="size-5 text-neutral-400" />
                          <div>
                            <div className={`text-sm font-semibold ${price < 30 ? "text-emerald-600" : "text-neutral-900"}`}>From ${price}</div>
                            {event.espn_price?.available != null && event.espn_price.available > 0 && (
                              <div className="text-xs text-neutral-500">{event.espn_price.available.toLocaleString()} left</div>
                            )}
                          </div>
                        </div>
                      )}
                      {event.away_record && event.home_record && (
                        <div className="flex items-center gap-2">
                          <Star className="size-5 text-neutral-400" />
                          <div className="text-sm">
                            <div className="font-semibold text-neutral-900">{home} {event.home_record}</div>
                            <div className="text-xs text-neutral-500">{away} {event.away_record}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Odds section */}
                    {event.odds && away && (
                      <div className="py-8 border-b border-neutral-200">
                        <h2 className="text-[22px] font-semibold text-neutral-900 mb-4">Win probability</h2>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-base text-neutral-600">{away}</span>
                            <span className="text-base font-semibold text-neutral-900">{event.odds.away_win}%</span>
                          </div>
                          <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden flex">
                            <div className="h-full rounded-l-full bg-neutral-900" style={{ width: `${event.odds.away_win}%` }} />
                            <div className="h-full rounded-r-full bg-neutral-300" style={{ width: `${event.odds.home_win}%` }} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-base text-neutral-600">{home}</span>
                            <span className="text-base font-semibold text-neutral-900">{event.odds.home_win}%</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Weather */}
                    {(() => {
                      const weatherKey = `${event.lat},${event.lng},${event.est_date || date}`;
                      const hours = weather[weatherKey];
                      const wLoading = weatherLoading.has(weatherKey);
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
                                const tipoffHr = event.date_time_utc ? new Date(event.date_time_utc).getHours() : -1;
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
                        {transitTab === "flights" && airports.length > 0 && <TransitRows stops={airports} icon={Plane} vLat={event.lat!} vLng={event.lng!} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop, event.date_time_utc)} onRouteFocus={onRouteFocus} isAnimating={false} venueName={event.venue} colorClass="text-[--color-flight]" tipoffUtc={event.date_time_utc} />}
                        {transitTab === "trains" && trains.length > 0 && <TransitRows stops={trains} icon={TrainFront} vLat={event.lat!} vLng={event.lng!} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop, event.date_time_utc)} onRouteFocus={onRouteFocus} isAnimating={false} venueName={event.venue} colorClass="text-[--color-train]" tipoffUtc={event.date_time_utc} />}
                        {transitTab === "buses" && buses.length > 0 && <TransitRows stops={buses} icon={BusFront} vLat={event.lat!} vLng={event.lng!} enriched={enriched} enriching={enriching} onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop, event.date_time_utc)} onRouteFocus={onRouteFocus} isAnimating={false} venueName={event.venue} colorClass="text-[--color-bus]" tipoffUtc={event.date_time_utc} />}
                      </div>
                    )}

                    {/* Airport Status */}
                    {(() => {
                      const aptCodes = airports.map((a) => a.code);
                      const delayKey = aptCodes.sort().join(",");
                      const delays = airportDelays[delayKey];
                      const dLoading = delaysLoading.has(delayKey);
                      if (aptCodes.length === 0 || (!delays && !dLoading)) return null;
                      return (
                        <div className="py-8 border-b border-neutral-200">
                          <h2 className="text-[22px] font-semibold text-neutral-900 mb-4">Airport status</h2>
                          {dLoading && !delays && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Checking delays...</div>}
                          {delays && (
                            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                              {delays.map((d) => {
                                const hasDelay = (d.departureDel != null && d.departureDel > 0) || (d.arrivalDel != null && d.arrivalDel > 0);
                                return (
                                  <div key={d.code} className={`shrink-0 rounded-xl px-4 py-2.5 text-center min-w-[80px] ${hasDelay ? "bg-amber-50 border border-amber-200" : "bg-neutral-50"}`}>
                                    <div className="text-sm font-bold text-neutral-900">{d.code}</div>
                                    {hasDelay ? (
                                      <div className="mt-0.5">
                                        {d.departureDel != null && d.departureDel > 0 && <div className="text-xs text-amber-600 font-medium">+{d.departureDel}m</div>}
                                        {d.arrivalDel != null && d.arrivalDel > 0 && <div className="text-xs text-amber-600 font-medium">+{d.arrivalDel}m</div>}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-emerald-600 font-medium mt-0.5">On time</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Last Transit Home */}
                    {(() => {
                      if (!event.date_time_utc) return null;
                      const ltKey = `${event.lat},${event.lng},${event.date_time_utc}`;
                      const ltData = lastTransit[ltKey];
                      const ltLoading = lastTransitLoading.has(ltKey);
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
                      const policy = venuePolicies[event.venue];
                      const loading = policyLoading.has(event.venue);
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
                      const hotels = nearbyHotels[event.venue];
                      const loading = hotelsLoading.has(event.venue);
                      if (!hotels && !loading) return null;
                      const arriveByEpoch = event.date_time_utc ? Math.floor((new Date(event.date_time_utc).getTime() - 45 * 60 * 1000) / 1000) : undefined;
                      return (
                        <div className="py-8 border-b border-neutral-200">
                          <div className="flex items-center justify-between mb-4">
                            <h2 className="text-[22px] font-semibold text-neutral-900">Where to stay</h2>
                            {hotels && hotels.length > 0 && <a href={hotels[0].bookingUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-neutral-900 underline hover:text-neutral-600">Browse more on Google</a>}
                          </div>
                          {loading && !hotels && <div className="flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="size-4 animate-spin" /> Loading...</div>}
                          {hotels && hotels.length > 0 && (
                            <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-6 px-6 pb-2">
                              {hotels.map((h, hi) => (
                                <a key={hi} href={h.bookingUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-[240px] rounded-xl overflow-hidden hover:shadow-lg transition-shadow no-underline block group">
                                  <div className="h-[160px] bg-neutral-100 overflow-hidden">
                                    {h.photoUrl ? (
                                      <img src={h.photoUrl} alt={h.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-neutral-400"><Hotel className="size-10" /></div>
                                    )}
                                  </div>
                                  <div className="p-3">
                                    <div className="flex items-center justify-between">
                                      <div className="text-sm font-semibold text-neutral-900 truncate flex-1">{h.name}</div>
                                      {h.rating && <span className="flex items-center gap-0.5 text-sm shrink-0 ml-2"><Star className="size-3.5 text-neutral-900" /> {h.rating}</span>}
                                    </div>
                                    <div className="text-sm text-neutral-500 mt-0.5">{h.distanceMiles} mi from venue</div>
                                    <div className="text-sm font-semibold text-neutral-900 mt-1">{h.estimatedPrice}</div>
                                    <div className="flex items-center gap-2 mt-2 text-xs text-neutral-500">
                                      <span className="flex items-center gap-1"><Car className="size-3" /> {h.driveMinutes}m</span>
                                      {h.transitMinutes != null && <span className="flex items-center gap-1"><Bus className="size-3" /> {h.transitMinutes}m</span>}
                                      <span className="flex items-center gap-1"><Footprints className="size-3" /> {h.walkMinutes}m</span>
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
                      const parkKey = `${event.lat},${event.lng}`;
                      const spots = nearbyParking[parkKey];
                      const pLoading = parkingLoading.has(parkKey);
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

                    {/* Local News */}
                    {(() => {
                      const newsKey = `${event.city},${event.state}`;
                      const news = localNews[newsKey];
                      const nLoading = newsLoading.has(newsKey);
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
                          { label: "Ticketmaster", href: event.url, icon: "https://www.google.com/s2/favicons?domain=ticketmaster.com&sz=32" },
                          away ? { label: "StubHub", href: stubhubUrl(home), icon: "https://www.google.com/s2/favicons?domain=stubhub.com&sz=32" } : null,
                          event.espn_price?.url ? { label: "VividSeats", href: event.espn_price.url, icon: "https://www.google.com/s2/favicons?domain=vividseats.com&sz=32" } : null,
                          kalshiUrl ? { label: "Kalshi", href: kalshiUrl, icon: "https://www.google.com/s2/favicons?domain=kalshi.com&sz=32" } : null,
                          { label: "ESPN", href: `https://www.espn.com/nba/scoreboard/_/date/${date.replace(/-/g, "")}`, icon: "https://www.google.com/s2/favicons?domain=espn.com&sz=32" },
                          venuePolicies[event.venue]?.websiteUrl ? { label: "Venue site", href: venuePolicies[event.venue].websiteUrl, icon: "https://www.google.com/s2/favicons?domain=" + new URL(venuePolicies[event.venue].websiteUrl).hostname + "&sz=32" } : null,
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
        })()}
      </div>
    </div>
  );
}
