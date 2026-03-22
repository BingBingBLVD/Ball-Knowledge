"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import type { VenuePolicy } from "@/lib/venue-policies";
import { SearchBar } from "./search-bar";
import { DateSelector } from "./date-selector";
import { useRampage } from "@/lib/rampage-context";

type TrayState = "collapsed" | "peek" | "expanded";

interface GameEvent {
  id: string;
  name: string;
  url: string;
  est_date?: string;
  est_time: string | null;
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

function formatTimeEST(time: string | null) {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period} ET`;
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

function gmapsUrl(fromLat: number, fromLng: number, toLat: number, toLng: number, mode: "driving" | "transit") {
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=${mode}`;
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

function TransitCards({
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
}) {
  if (stops.length === 0) return null;
  const enrichKey = (sLat: number, sLng: number) => `${vLat},${vLng};${sLat},${sLng}`;

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar">
      {stops.map((stop) => {
        const ek = enrichKey(stop.lat, stop.lng);
        const times = enriched[ek] ?? null;
        const loading = enriching.has(ek);
        const baseFocus = { venueLat: vLat, venueLng: vLng, airportLat: stop.lat, airportLng: stop.lng, airportCode: stop.code, venueName };

        return (
          <div
            key={stop.code}
            className="flex flex-col gap-1 text-[11px] font-mono rounded border border-white/5 bg-white/[0.02] px-2.5 py-2 min-w-[8rem] shrink-0"
            onMouseEnter={() => !isAnimating && onRouteFocus(baseFocus)}
            onMouseLeave={() => !isAnimating && onRouteFocus(null)}
          >
            {/* Stop header */}
            <div className="flex items-center gap-1.5">
              <span className={`flex items-center gap-1 font-bold ${colorClass}`}>
                <Icon className="size-3.5" />
                {stop.code}
              </span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--color-dim] hover:text-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}
                title={`Open ${stop.code} in Google Maps`}
              >
                <Map className="size-3" />
              </a>
              <span className="ml-auto font-normal text-[10px] text-[--color-dim]">({Math.round(haversineMiles(vLat, vLng, stop.lat, stop.lng))}mi)</span>
            </div>
            {/* Transport options */}
            {times ? (
              <div className="flex flex-col gap-0.5 mt-0.5 text-[10px]">
                <div className="flex items-center gap-1 flex-wrap">
                  <a
                    href={gmapsUrl(vLat, vLng, stop.lat, stop.lng, "driving")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[--color-dim] hover:text-foreground border border-white/10 no-underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Car className="size-3" /> {formatDriveTime(times.driveMinutes)}
                  </a>
                  <a
                    href={uberDeepLink(vLat, vLng, stop.lat, stop.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-[#191919] text-white font-semibold hover:bg-[#2a2a2a] transition-colors no-underline border border-white/10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-white">UBER</span> {times.uberEstimate ? <span className="text-white">~&lt;{extractUpperBound(times.uberEstimate)}</span> : <span className="text-emerald-400">--</span>}
                  </a>
                  <a
                    href={lyftDeepLink(vLat, vLng, stop.lat, stop.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-[#d4004c] text-white font-semibold hover:bg-[#e0105a] transition-colors no-underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-white">LYFT</span> {times.lyftEstimate ? <span className="text-white">~&lt;{extractUpperBound(times.lyftEstimate)}</span> : <span className="text-emerald-400">--</span>}
                  </a>
                </div>
                {times.transitMinutes != null && (
                  <a
                    href={gmapsUrl(vLat, vLng, stop.lat, stop.lng, "transit")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[--color-dim] hover:text-foreground border border-white/10 no-underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Bus className="size-3" /> {formatDriveTime(times.transitMinutes)} {times.transitFare ? <span>{times.transitFare}</span> : <span className="text-emerald-400">--</span>}
                  </a>
                )}
              </div>
            ) : (
              <button
                className={`text-[--color-dim] hover:text-foreground mt-0.5 flex items-center gap-1 ${loading ? "[&>svg]:animate-spin" : ""}`}
                onClick={(e) => { e.stopPropagation(); onEnrich(stop); }}
                title="Load transit info"
              >
                <RefreshCw className="size-2.5" /> {loading ? "Loading…" : "Load info"}
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevTrayState = useRef(trayState);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // Track which transit sub-modes are visible per event
  const [shownTrains, setShownTrains] = useState<Set<string>>(new Set());
  const [shownBuses, setShownBuses] = useState<Set<string>>(new Set());
  const [shownPolicies, setShownPolicies] = useState<Set<string>>(new Set());

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

  const handleEnrich = useCallback(async (venueLat: number, venueLng: number, stop: TransitStop) => {
    const key = enrichKey(venueLat, venueLng, stop.lat, stop.lng);
    if (enriched[key] || enriching.has(key)) return;
    setEnriching((prev) => new Set(prev).add(key));
    try {
      const res = await fetch(
        `/api/travel-times?fromLat=${venueLat}&fromLng=${venueLng}&toLat=${stop.lat}&toLng=${stop.lng}`
      );
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
        <div className="flex items-center select-none border-b border-white/5">
          {/* Search */}
          <div className="flex-1 min-w-0 border-r border-white/5">
            <SearchBar value={search} onChange={onSearchChange} onLocationChange={onLocationChange} />
          </div>
          {/* Filters */}
          {trayState !== "collapsed" && (
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
                  className="absolute right-0 bottom-full mb-2 w-40 rounded-lg border border-white/10 panel-elevated shadow-xl z-50 py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-3 py-1.5 text-[10px] font-mono tracking-widest text-[--color-dim] uppercase border-b border-white/5">
                    Columns
                  </div>
                  {ALL_COLUMNS.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => toggleColumn(col.id)}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-mono hover:bg-white/5 transition-colors"
                    >
                      <span className={`size-3.5 rounded border flex items-center justify-center transition-colors ${
                        visibleColumns.has(col.id)
                          ? "bg-[--primary] border-[--primary] text-white"
                          : "border-white/20"
                      }`}>
                        {visibleColumns.has(col.id) && <Check className="size-2.5" />}
                      </span>
                      <span className={visibleColumns.has(col.id) ? "text-foreground" : "text-[--color-dim]"}>
                        {col.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
          <div className="px-6 py-1.5 border-b border-white/5 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-2.5 text-[9px] font-mono tracking-widest uppercase" style={{ minWidth: visibleColumns.size > 3 ? "600px" : undefined }}>
              {visibleColumns.has("ticket") && (
                <span onClick={() => handleHeaderSort("price")} className={`shrink-0 min-w-[2.5rem] cursor-pointer hover:text-foreground transition-colors ${sortKey === "price" ? "text-foreground" : "text-[--color-dim]"}`}>
                  TICKET{sortKey === "price" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {visibleColumns.has("record") && (
                <span onClick={() => handleHeaderSort("record")} className={`shrink-0 min-w-[3.2rem] cursor-pointer hover:text-foreground transition-colors ${sortKey === "record" ? "text-foreground" : "text-[--color-dim]"}`}>
                  REC{sortKey === "record" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {showOdds && visibleColumns.has("odds") && (
                <span onClick={() => handleHeaderSort("odds")} className={`shrink-0 min-w-[2.5rem] cursor-pointer hover:text-foreground transition-colors ${sortKey === "odds" ? "text-foreground" : "text-[--color-dim]"}`}>
                  ODDS{sortKey === "odds" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {visibleColumns.has("team") && (
                <span onClick={() => handleHeaderSort("team")} className={`flex-1 min-w-0 cursor-pointer hover:text-foreground transition-colors ${sortKey === "team" ? "text-foreground" : "text-[--color-dim]"}`}>
                  TEAM{sortKey === "team" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {visibleColumns.has("stadium") && (
                <span onClick={() => handleHeaderSort("dist")} className={`flex-1 min-w-0 cursor-pointer hover:text-foreground transition-colors ${sortKey === "dist" ? "text-foreground" : "text-[--color-dim]"}`}>
                  STADIUM{sortKey === "dist" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </span>
              )}
              {visibleColumns.has("time") && (
                <span onClick={() => handleHeaderSort("time")} className={`shrink-0 cursor-pointer hover:text-foreground transition-colors ${sortKey === "time" ? "text-foreground" : "text-[--color-dim]"}`}>
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
              <div className="flex items-center justify-center py-12 text-[--color-dim] text-sm font-mono">
                NO GAMES AVAILABLE
              </div>
            )}
            {sortedGames.map((event) => {
              const parts = event.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
              const home = parts[0].replace(/\s*\(.*?\)/g, "").trim();
              const away = parts.length > 1 ? parts.slice(1).join(" vs ").replace(/\s*\(.*?\)/g, "").trim() : null;
              const isRampageSelected = rampage.active && event.est_date && rampage.selectedGames.has(event.est_date) && rampage.selectedGames.get(event.est_date)!.id === event.id;
              const isSelected = !rampage.active && selectedVenue === event.venue;
              const isHovered = !rampage.active && hoveredVenue === event.venue;
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
                  className={`rounded card-enter transition-colors cursor-pointer ${
                    isRampageSelected
                      ? "border-l-2 border-[--color-rampage] bg-[--color-rampage]/5 panel-elevated"
                      : isSelected
                        ? "border-l-2 border-[--primary] bg-[--primary]/5 panel-elevated"
                        : isHovered
                          ? "border-l-2 border-[--primary]/50 bg-[--primary]/[0.03] panel-elevated"
                          : "panel hover:bg-white/[0.02]"
                  }`}
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
                        min_price: event.min_price,
                      });
                      // Auto-advance to next date when selecting (not deselecting)
                      if (!wasSelected) {
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
                      for (const s of airports) {
                        handleEnrich(vLat, vLng, s);
                      }
                      handlePolicyLoad(event.venue);
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
                    setExpandedCardId(isExpanded ? null : event.id);
                  }}
                >
                  {/* Card header — always visible */}
                  <div className="px-3 py-2.5 overflow-x-auto no-scrollbar">
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
                            <span className={`font-mono text-sm font-semibold ${price < 30 ? "text-emerald-400" : "text-foreground"}`}>${price}</span>
                          )}
                          {event.espn_price?.available != null && event.espn_price.available > 0 && (
                            <span className="font-mono text-[10px] text-[--color-dim]">{event.espn_price.available}<br/>available</span>
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
                              <span className="text-sm font-semibold uppercase text-foreground truncate"><span className="text-[--color-dim] font-normal mr-1">@</span>{home}</span>
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
                          <span className="text-[10px] text-[--color-dim] font-mono truncate">{event.city}, {event.state}{dist != null ? ` · ${Math.round(dist)}mi` : ""}</span>
                        </div>
                      )}
                      {/* Col: Time */}
                      {visibleColumns.has("time") && (
                        <div className="shrink-0">
                          <span className="font-mono text-sm text-foreground">{formatTimeEST(event.est_time)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded section */}
                  {isExpanded && (
                    <div className="px-3 pb-3 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                      {/* Transit section */}
                      {(airports.length > 0 || trains.length > 0 || buses.length > 0) && event.lat != null && event.lng != null && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <div className="text-[10px] font-mono tracking-widest text-[--color-dim] uppercase">DISTANCE FROM STADIUM</div>
                            {trains.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShownTrains((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(event.id)) { next.delete(event.id); } else {
                                      next.add(event.id);
                                      for (const s of trains) handleEnrich(event.lat!, event.lng!, s);
                                    }
                                    return next;
                                  });
                                }}
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                                  shownTrains.has(event.id)
                                    ? "border-[--color-train]/30 text-[--color-train] bg-[--color-train]/10 font-semibold"
                                    : "border-white/10 text-[--color-dim] hover:text-[--color-train] hover:border-[--color-train]/20"
                                }`}
                              >
                                {shownTrains.has(event.id) ? "Hide" : "Show"} Trains
                              </button>
                            )}
                            {buses.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShownBuses((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(event.id)) { next.delete(event.id); } else {
                                      next.add(event.id);
                                      for (const s of buses) handleEnrich(event.lat!, event.lng!, s);
                                    }
                                    return next;
                                  });
                                }}
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                                  shownBuses.has(event.id)
                                    ? "border-[--color-bus]/30 text-[--color-bus] bg-[--color-bus]/10 font-semibold"
                                    : "border-white/10 text-[--color-dim] hover:text-[--color-bus] hover:border-[--color-bus]/20"
                                }`}
                              >
                                {shownBuses.has(event.id) ? "Hide" : "Show"} Bus
                              </button>
                            )}
                          </div>
                          {airports.length > 0 && (
                            <TransitCards
                              stops={airports}
                              icon={Plane}
                              vLat={event.lat!}
                              vLng={event.lng!}
                              enriched={enriched}
                              enriching={enriching}
                              onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop)}
                              onRouteFocus={onRouteFocus}
                              isAnimating={isAnimating}
                              venueName={event.venue}
                              colorClass="text-[--color-flight]"
                            />
                          )}
                          {shownTrains.has(event.id) && trains.length > 0 && (
                            <TransitCards
                              stops={trains}
                              icon={TrainFront}
                              vLat={event.lat!}
                              vLng={event.lng!}
                              enriched={enriched}
                              enriching={enriching}
                              onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop)}
                              onRouteFocus={onRouteFocus}
                              isAnimating={isAnimating}
                              venueName={event.venue}
                              colorClass="text-[--color-train]"
                            />
                          )}
                          {shownBuses.has(event.id) && buses.length > 0 && (
                            <TransitCards
                              stops={buses}
                              icon={BusFront}
                              vLat={event.lat!}
                              vLng={event.lng!}
                              enriched={enriched}
                              enriching={enriching}
                              onEnrich={(stop) => handleEnrich(event.lat!, event.lng!, stop)}
                              onRouteFocus={onRouteFocus}
                              isAnimating={isAnimating}
                              venueName={event.venue}
                              colorClass="text-[--color-bus]"
                            />
                          )}
                        </div>
                      )}

                      {/* Venue policy section */}
                      {(() => {
                        const policy = venuePolicies[event.venue];
                        const loading = policyLoading.has(event.venue);
                        const expanded = shownPolicies.has(event.id);
                        const allowed = policy?.items.filter((i) => i.allowed) ?? [];
                        const prohibited = policy?.items.filter((i) => !i.allowed) ?? [];

                        return (policy || loading) ? (
                          <div className="mt-2">
                            <div className="flex items-center gap-2">
                              <div className="text-[10px] font-mono tracking-widest text-[--color-dim] uppercase flex items-center gap-1">
                                <ShieldCheck className="size-3" /> VENUE POLICY
                              </div>
                              {policy && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShownPolicies((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(event.id)) next.delete(event.id);
                                      else next.add(event.id);
                                      return next;
                                    });
                                  }}
                                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                                    expanded
                                      ? "border-amber-400/30 text-amber-400 bg-amber-400/10 font-semibold"
                                      : "border-white/10 text-[--color-dim] hover:text-amber-400 hover:border-amber-400/20"
                                  }`}
                                >
                                  {expanded ? "Hide" : "Details"}
                                </button>
                              )}
                            </div>
                            {loading && !policy && (
                              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] font-mono text-[--color-dim]">
                                <Loader2 className="size-3 animate-spin" /> Loading policy...
                              </div>
                            )}
                            {policy && (
                              <div className="mt-1">
                                {/* Summary line — always visible */}
                                <div className="text-[11px] font-mono text-[--color-dim]">
                                  {policy.clearBagRequired && (
                                    <span className="text-amber-400 font-semibold">Clear bag required</span>
                                  )}
                                  {policy.maxBagSize && (
                                    <span>{policy.clearBagRequired ? " · " : ""}Max {policy.maxBagSize}</span>
                                  )}
                                </div>
                                {/* Expanded details */}
                                {expanded && (
                                  <div className="mt-1.5 flex gap-4 text-[11px] font-mono">
                                    {allowed.length > 0 && (
                                      <div className="flex-1 min-w-0 space-y-0.5">
                                        {allowed.map((item) => (
                                          <div key={item.name} className="flex items-start gap-1 text-emerald-400">
                                            <Check className="size-3 shrink-0 mt-0.5" />
                                            <span>{item.name}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {prohibited.length > 0 && (
                                      <div className="flex-1 min-w-0 space-y-0.5">
                                        {prohibited.map((item) => (
                                          <div key={item.name} className="flex items-start gap-1 text-red-400">
                                            <Ban className="size-3 shrink-0 mt-0.5" />
                                            <span>{item.name}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {expanded && policy.policyUrl && (
                                  <a
                                    href={policy.policyUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-1.5 text-[10px] font-mono text-[--color-dim] hover:text-foreground underline inline-flex items-center gap-0.5"
                                  >
                                    View full policy <ArrowUpRight className="size-2.5" />
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        ) : null;
                      })()}

                      {/* Take Me button */}
                      {userLocation && event.lat != null && event.est_time ? (
                        <a
                          href={`/take-me?originLat=${userLocation.lat}&originLng=${userLocation.lng}&venue=${encodeURIComponent(event.venue)}&venueLat=${event.lat}&venueLng=${event.lng}&date=${date}&time=${event.est_time}&game=${encodeURIComponent(event.name)}`}
                          className="mt-3 flex items-center justify-center gap-2 w-full py-2 rounded font-mono text-sm font-semibold border border-[--primary] text-[--primary] hover:bg-[--primary]/10 transition-colors press-scale"
                        >
                          <Navigation className="size-4" /> TAKE ME
                        </a>
                      ) : (
                        <div className="mt-3 flex items-center justify-center gap-2 w-full py-2 rounded font-mono text-[11px] text-[--color-dim] border border-white/5">
                          SET LOCATION TO PLAN ROUTE
                        </div>
                      )}

                      {/* Links section */}
                      <div className="mt-2">
                        <div className="text-[10px] font-mono tracking-widest text-[--color-dim] uppercase mb-1">LINKS</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono">
                          <a href={event.url} target="_blank" rel="noopener noreferrer" className="text-[--color-dim] hover:text-foreground underline inline-flex items-center gap-0.5">
                            TICKETMASTER <ArrowUpRight className="size-2.5" />
                          </a>
                          {away && (
                            <a href={stubhubUrl(home)} target="_blank" rel="noopener noreferrer" className="text-[--color-dim] hover:text-foreground underline inline-flex items-center gap-0.5">
                              STUBHUB <ArrowUpRight className="size-2.5" />
                            </a>
                          )}
                          {event.espn_price?.url && (
                            <a href={event.espn_price.url} target="_blank" rel="noopener noreferrer" className="text-[--color-dim] hover:text-foreground underline inline-flex items-center gap-0.5">
                              VIVIDSEATS <ArrowUpRight className="size-2.5" />
                            </a>
                          )}
                          {kalshiUrl && (
                            <a href={kalshiUrl} target="_blank" rel="noopener noreferrer" className="text-[--color-dim] hover:text-foreground underline inline-flex items-center gap-0.5">
                              KALSHI <ArrowUpRight className="size-2.5" />
                            </a>
                          )}
                          <a href={`https://www.espn.com/nba/scoreboard/_/date/${date.replace(/-/g, "")}`} target="_blank" rel="noopener noreferrer" className="text-[--color-dim] hover:text-foreground underline inline-flex items-center gap-0.5">
                            ESPN <ArrowUpRight className="size-2.5" />
                          </a>
                          {venuePolicies[event.venue]?.websiteUrl && (
                            <a href={venuePolicies[event.venue].websiteUrl} target="_blank" rel="noopener noreferrer" className="text-[--color-dim] hover:text-foreground underline inline-flex items-center gap-0.5">
                              VENUE <ArrowUpRight className="size-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
