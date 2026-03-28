"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plane,
  Bus,
  BusFront,
  Car,
  TrainFront,
  MapPin,
  ArrowRight,
  ArrowLeft,
  Zap,
  ArrowUpRight,
  Loader2,
  Share2,
  Ticket,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { GameDetailPopover, type GameEvent } from "@/components/game-detail-popover";
import { PlayerHoverCardProvider } from "@/components/player-hover-card";

// ── Types ──────────────────────────────────────────────────────────────────

interface Leg {
  mode: "flight" | "drive" | "rideshare" | "transit" | "bus" | "train";
  carrier?: string;
  routeName?: string;
  from: string;
  fromLat: number;
  fromLng: number;
  to: string;
  toLat: number;
  toLng: number;
  depart: string;
  arrive: string;
  minutes: number;
  cost: number | null;
  bookingUrl?: string;
  miles: number;
  uberEstimate?: string;
  lyftEstimate?: string;
}

interface Itinerary {
  id: string;
  totalMinutes: number;
  totalCost: number | null;
  departureTime: string;
  arrivalTime: string;
  bufferMinutes: number;
  legs: Leg[];
}

interface TransitOption {
  transitMinutes: number;
  transitFare: string | null;
  transitDepartureTime: string | null;
  transitArrivalTime: string | null;
  uberEstimate: string | null;
  lyftEstimate: string | null;
  googleMapsUrl: string;
}

interface RampageLeg {
  from: { name: string; lat: number; lng: number };
  to: { name: string; lat: number; lng: number };
  date: string;
  itineraries: Itinerary[];
  transitOption?: TransitOption | null;
  googleFlightsUrl?: string;
  originAirportCode?: string;
  destAirportCode?: string;
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

interface HotelGroup {
  date: string;
  venue: string;
  suggestions: HotelSuggestion[];
}

interface RampageGame {
  id: string;
  name: string;
  venue: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  est_date: string;
  est_time: string | null;
  local_time?: string | null;
  tz?: string | null;
  date_time_utc?: string | null;
  min_price: { amount: number; currency: string } | null;
  espn_price?: { amount: number; available: number; url: string | null } | null;
  odds?: { away_team: string; home_team: string; away_win: number; home_win: number; kalshi_event: string } | null;
  away_record?: string | null;
  home_record?: string | null;
}

interface SavedCow {
  id: string;
  createdAt: string;
  startLocation: { lat: number; lng: number; label: string };
  endLocation: { lat: number; lng: number; label: string };
  games: RampageGame[];
}

interface RampageResult {
  legs: RampageLeg[];
  hotels: HotelGroup[];
  games: RampageGame[];
  summary: {
    transportCost: number | null;
    ticketCost: number;
    totalCost: number | null;
    totalMinutes: number;
    minMinutes?: number;
    maxMinutes?: number;
    gameCount: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(time: string | null, tz?: string | null): string {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period} ${tz ?? "ET"}`;
}

const TZ_ABBR_TO_IANA: Record<string, string> = {
  ET: "America/New_York", EDT: "America/New_York", EST: "America/New_York",
  CT: "America/Chicago", CDT: "America/Chicago", CST: "America/Chicago",
  MT: "America/Denver", MDT: "America/Denver", MST: "America/Denver",
  PT: "America/Los_Angeles", PDT: "America/Los_Angeles", PST: "America/Los_Angeles",
};

function formatUserLocalTime(utc: string | null | undefined, venueTz?: string | null): { text: string; tz: string; offsetLabel: string | null } | null {
  if (!utc) return null;
  const d = new Date(utc);
  if (isNaN(d.getTime())) return null;
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: userTz, hour: "numeric", minute: "2-digit", hour12: true });
  const tzFmt = new Intl.DateTimeFormat("en-US", { timeZone: userTz, timeZoneName: "short" });
  const tzAbbr = tzFmt.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
  let offsetLabel: string | null = null;
  const venueIana = venueTz ? TZ_ABBR_TO_IANA[venueTz] ?? null : null;
  if (venueIana) {
    const venueHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: venueIana, hour: "numeric", hour12: false }).format(d));
    const userHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: userTz, hour: "numeric", hour12: false }).format(d));
    const diff = userHour - venueHour;
    if (diff !== 0) offsetLabel = diff > 0 ? `(+${diff}h)` : `(${diff}h)`;
  }
  return { text: timeFmt.format(d).replace(/\u202f/g, " "), tz: tzAbbr, offsetLabel };
}

function modeIcon(mode: string) {
  switch (mode) {
    case "flight": return <Plane className="size-4" />;
    case "drive":
    case "rideshare": return <Car className="size-4" />;
    case "bus": return <BusFront className="size-4" />;
    case "train": return <TrainFront className="size-4" />;
    case "transit": return <Bus className="size-4" />;
    default: return <Car className="size-4" />;
  }
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "flight": return "Fly";
    case "drive": return "Drive";
    case "rideshare": return "Rideshare";
    case "bus": return "Bus";
    case "train": return "Train";
    case "transit": return "Transit";
    default: return mode;
  }
}

function modeColor(mode: string): string {
  switch (mode) {
    case "flight": return "text-[--color-flight]";
    case "drive":
    case "rideshare": return "text-[--color-drive]";
    case "bus": return "text-[--color-bus]";
    case "train": return "text-[--color-train]";
    case "transit": return "text-[--color-transit]";
    default: return "text-neutral-500";
  }
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function RampagePage() {
  return (
    <PlayerHoverCardProvider>
      <Suspense fallback={
        <div className="min-h-dvh bg-[var(--background)] flex items-center justify-center">
          <Loader2 className="size-8 text-[--color-rampage] animate-spin" />
        </div>
      }>
        <RampageContent />
      </Suspense>
    </PlayerHoverCardProvider>
  );
}

function RampageContent() {
  const searchParams = useSearchParams();
  const cowId = searchParams.get("cow");

  const [cow, setCow] = useState<SavedCow | null>(null);
  const [result, setResult] = useState<RampageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const [popoverGameId, setPopoverGameId] = useState<string | null>(null);
  const [popoverVisible, setPopoverVisible] = useState(false);

  function openPopover(gameId: string) {
    setPopoverGameId(gameId);
    requestAnimationFrame(() => setPopoverVisible(true));
  }

  function closePopover() {
    setPopoverVisible(false);
    setTimeout(() => setPopoverGameId(null), 300);
  }

  // Load cow from localStorage, falling back to DB for shared links
  useEffect(() => {
    if (!cowId) {
      setError("No rampage ID provided");
      setLoading(false);
      return;
    }
    try {
      const raw = localStorage.getItem(`balltastic_cow_${cowId}`);
      if (raw) { setCow(JSON.parse(raw)); return; }
    } catch { /* fall through to API */ }
    fetch(`/api/cow?id=${encodeURIComponent(cowId)}`)
      .then((res) => { if (!res.ok) throw new Error("Not found"); return res.json(); })
      .then((data: SavedCow) => {
        setCow(data);
        try { localStorage.setItem(`balltastic_cow_${cowId}`, JSON.stringify(data)); } catch { /* ignore */ }
      })
      .catch(() => { setError("Rampage plan not found"); setLoading(false); });
  }, [cowId]);

  // Fetch routes once cow is loaded (skip if pre-fetched from main page)
  useEffect(() => {
    if (!cow) return;
    // Check for pre-fetched result from main page
    const prefetchKey = `balltastic_rampage_result_${cowId}`;
    try {
      const cached = localStorage.getItem(prefetchKey);
      if (cached) {
        localStorage.removeItem(prefetchKey);
        const data: RampageResult = JSON.parse(cached);
        data.games = cow.games;
        setResult(data);
        setLoading(false);
        return;
      }
    } catch { /* fall through to fetch */ }

    async function fetchRampage() {
      try {
        const res = await fetch("/api/rampage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startLocation: cow!.startLocation,
            endLocation: cow!.endLocation,
            games: cow!.games.map((g) => ({
              venue: g.venue, lat: g.lat, lng: g.lng, date: g.est_date,
              time: g.est_time ?? "19:00", name: g.name,
              min_price: g.min_price, espn_price: g.espn_price,
            })),
          }),
        });
        if (!res.ok) throw new Error("Failed to fetch rampage plan");
        const data: RampageResult = await res.json();
        data.games = cow!.games;
        setResult(data);
      } catch (err) { setError((err as Error).message); }
      finally { setLoading(false); }
    }
    fetchRampage();
  }, [cow, cowId]);

  // Init map
  useEffect(() => {
    if (!result || !mapRef.current || googleMapRef.current) return;
    async function initMap() {
      setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "", v: "weekly" });
      await Promise.all([importLibrary("maps"), importLibrary("marker")]);
      if (!mapRef.current) return;
      const map = new google.maps.Map(mapRef.current, {
        center: { lat: 39.8, lng: -98.5 }, zoom: 4, mapId: "rampage_map",
        disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy",
      });
      googleMapRef.current = map;
      const bounds = new google.maps.LatLngBounds();
      const points: { lat: number; lng: number }[] = [];
      if (cow) {
        const startEl = document.createElement("div");
        startEl.style.cssText = "width:20px;height:20px;border-radius:50%;background:#22c55e;border:2.5px solid white;box-shadow:0 2px 8px rgba(34,197,94,0.4);";
        new google.maps.marker.AdvancedMarkerElement({ map, position: cow.startLocation, content: startEl });
        bounds.extend(cow.startLocation); points.push(cow.startLocation);
      }
      result!.games.forEach((game, i) => {
        const el = document.createElement("div");
        el.style.cssText = `width:28px;height:28px;border-radius:50%;background:#3b82f6;color:white;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2.5px solid white;box-shadow:0 2px 8px rgba(59,130,246,0.4);`;
        el.textContent = String(i + 1);
        new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: game.lat, lng: game.lng }, content: el });
        bounds.extend({ lat: game.lat, lng: game.lng }); points.push({ lat: game.lat, lng: game.lng });
      });
      if (cow) {
        const endEl = document.createElement("div");
        endEl.style.cssText = "width:20px;height:20px;border-radius:50%;background:#ef4444;border:2.5px solid white;box-shadow:0 2px 8px rgba(239,68,68,0.4);";
        new google.maps.marker.AdvancedMarkerElement({ map, position: cow.endLocation, content: endEl });
        bounds.extend(cow.endLocation); points.push(cow.endLocation);
      }
      if (points.length >= 2) {
        new google.maps.Polyline({ path: points, geodesic: true, strokeColor: "#3b82f6", strokeOpacity: 0.6, strokeWeight: 3, map });
      }
      map.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 });
    }
    initMap();
  }, [result, cow]);

  function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: "Ball Knowledge Rampage", url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => { alert("Link copied to clipboard!"); });
    }
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-[var(--background)] flex flex-col items-center justify-center gap-4">
        <div className="bg-white rounded-2xl shadow-sm px-8 py-6 flex flex-col items-center gap-3">
          <p className="text-[--color-danger] font-semibold text-sm">Something went wrong</p>
          <p className="text-sm text-neutral-500">{error}</p>
          <Link href="/" className="text-sm text-[--color-rampage] hover:underline">
            <ArrowLeft className="size-4 inline mr-1" />Back to map
          </Link>
        </div>
      </div>
    );
  }

  if (loading || !result || !cow) {
    return (
      <div className="min-h-dvh bg-[var(--background)] flex flex-col items-center justify-center gap-3">
        <div className="bg-white rounded-2xl shadow-sm px-8 py-6 flex flex-col items-center gap-3">
          <Loader2 className="size-8 text-[--color-rampage] animate-spin" />
          <p className="text-sm text-neutral-500">Planning your trip...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[var(--background)] text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-5 py-3.5 max-w-3xl mx-auto">
          <Link href="/" className="text-neutral-400 hover:text-neutral-900 transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <Zap className="size-5 text-[--color-rampage]" />
          <h1 className="text-base font-bold text-foreground flex-1">Rampage</h1>
          <button onClick={handleShare} className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition-colors">
            <Share2 className="size-3.5" /> Share
          </button>
        </div>
      </div>

      {/* Tight-time warning */}
      {(() => {
        const now = Date.now();
        const tight: { index: number; game: string }[] = [];
        result.games.forEach((game, i) => {
          const leg = result.legs[i];
          if (!leg) return;
          const cheapest = leg.itineraries.length ? leg.itineraries.reduce((a, b) => (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b) : null;
          if (!cheapest) return;
          const timeStr = game.est_time ?? "19:00";
          const month = new Date(game.est_date + "T12:00:00Z").getMonth();
          const offset = month >= 2 && month <= 10 ? "-04:00" : "-05:00";
          const gameStart = new Date(`${game.est_date}T${timeStr}:00${offset}`);
          const minutesAvailable = Math.floor((gameStart.getTime() - now) / 60000);
          if (minutesAvailable > 0 && cheapest.totalMinutes > minutesAvailable) {
            const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
            tight.push({ index: i + 1, game: parts.length > 1 ? `Game ${i + 1}` : game.name });
          }
        });
        if (tight.length === 0) return null;
        return (
          <div className="bg-amber-50 px-5 py-3">
            <div className="max-w-3xl mx-auto flex items-start gap-2.5">
              <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <span className="font-semibold">Tight schedule</span>
                <span className="text-amber-700"> — Travel time exceeds time until tipoff for {tight.map((t) => `Game ${t.index}`).join(", ")}. These legs may not be possible.</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Map */}
      <div className="max-w-3xl mx-auto px-5 pt-5">
        <div ref={mapRef} className="w-full h-[280px] sm:h-[380px] rounded-2xl overflow-hidden shadow-sm" />
      </div>

      {/* Summary strip */}
      <div className="max-w-3xl mx-auto px-5 pt-4">
        <div className="flex items-center gap-5 flex-wrap text-sm">
          <span className="text-neutral-500"><span className="font-semibold text-foreground">{result.summary.gameCount}</span> game{result.summary.gameCount !== 1 ? "s" : ""}</span>
          <span className="text-neutral-500"><span className="font-semibold text-foreground">{result.summary.minMinutes != null && result.summary.maxMinutes != null && result.summary.minMinutes !== result.summary.maxMinutes ? `${formatDuration(result.summary.minMinutes)}–${formatDuration(result.summary.maxMinutes)}` : formatDuration(result.summary.totalMinutes)}</span> travel</span>
          {result.summary.ticketCost > 0 && <span className="text-neutral-500"><span className="font-semibold text-foreground font-sans">${result.summary.ticketCost}</span> tickets</span>}
          {result.summary.transportCost != null && <span className="text-neutral-500"><span className="font-semibold text-foreground font-sans">~${result.summary.transportCost}</span> transport</span>}
          {result.summary.totalCost != null && <span className="font-semibold text-[--color-rampage] font-sans">~${result.summary.totalCost} total</span>}
        </div>
      </div>

      {/* Timeline */}
      <div className="max-w-3xl mx-auto px-5 py-6">
        {/* Start */}
        <div className="py-5">
          <div className="text-[15px] font-semibold text-neutral-900 leading-snug">{cow.startLocation.label}</div>
          {result.games[0] && <div className="text-sm text-neutral-500 mt-0.5">{result.games[0].city}, {result.games[0].state}</div>}
        </div>

        {/* Games */}
        <div className="divide-y divide-neutral-100">
        {result.games.map((game, i) => {
          const leg = result.legs[i];
          const cheapest = leg?.itineraries.length ? leg.itineraries.reduce((a, b) => (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b) : null;
          const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
          const home = parts[0].replace(/\s*\(.*?\)/g, "").trim();
          const away = parts.length > 1 ? parts.slice(1).join(" vs ").replace(/\s*\(.*?\)/g, "").trim() : null;
          const price = game.espn_price?.amount ?? game.min_price?.amount;

          return (
            <div key={game.id}>
              <TravelLegCard leg={leg} cheapest={cheapest} />
              {/* Game card — Airbnb listing row, click to open detail */}
              <div className="py-5 cursor-pointer hover:bg-neutral-50 transition-colors rounded-xl px-4 -mx-4" onClick={() => openPopover(game.id)}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold text-neutral-900 leading-snug">
                      {away ? <>{away} <span className="text-neutral-400 font-normal">@</span> {home}</> : game.name}
                    </div>
                    <div className="text-sm text-neutral-500 mt-0.5">{game.venue} · {game.city}, {game.state}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-neutral-400">
                      <span className="text-neutral-600 font-medium">{formatTime(game.local_time ?? game.est_time, game.tz)}{(() => { const u = formatUserLocalTime(game.date_time_utc, game.tz); return u && u.tz !== (game.tz ?? "ET") ? ` · ${u.text} ${u.tz}` : ""; })()}</span>
                      {game.away_record && game.home_record && <span>{game.away_record} vs {game.home_record}</span>}
                      {game.odds && <span>{game.odds.away_win}–{game.odds.home_win}%</span>}
                    </div>
                  </div>
                  {price != null && (
                    <div className="shrink-0 text-right pt-0.5">
                      <div className="text-[15px] font-semibold text-neutral-900 font-sans">${price}</div>
                      <div className="text-xs text-neutral-500">{game.espn_price?.available ? `${game.espn_price.available.toLocaleString()} left` : "per ticket"}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        </div>

        {/* Final leg */}
        {result.legs.length > result.games.length && (() => {
          const finalLeg = result.legs[result.legs.length - 1];
          const cheapest = finalLeg?.itineraries.length ? finalLeg.itineraries.reduce((a, b) => (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b) : null;
          return <TravelLegCard leg={finalLeg} cheapest={cheapest} />;
        })()}

        {/* End */}
        <div className="py-5">
          <div className="text-[15px] font-semibold text-neutral-900 leading-snug">{cow.endLocation.label}</div>
          {result.games[result.games.length - 1] && <div className="text-sm text-neutral-500 mt-0.5">{result.games[result.games.length - 1].city}, {result.games[result.games.length - 1].state}</div>}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 z-20 bg-white/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-5 py-3.5 max-w-3xl mx-auto text-sm">
          <div className="flex items-center gap-5 flex-wrap">
            <span className="text-neutral-500"><span className="text-[--color-rampage] font-semibold">{result.summary.gameCount}</span> game{result.summary.gameCount !== 1 ? "s" : ""}</span>
            <span className="text-neutral-500"><span className="text-foreground font-semibold">{result.summary.minMinutes != null && result.summary.maxMinutes != null && result.summary.minMinutes !== result.summary.maxMinutes ? `${formatDuration(result.summary.minMinutes)}–${formatDuration(result.summary.maxMinutes)}` : formatDuration(result.summary.totalMinutes)}</span> travel</span>
            {result.summary.ticketCost > 0 && <span className="text-neutral-500"><Ticket className="size-3.5 inline mr-0.5" /><span className="text-foreground font-semibold font-sans">${result.summary.ticketCost}</span> tickets</span>}
            {result.summary.transportCost != null && <span className="text-neutral-500"><Car className="size-3.5 inline mr-0.5" /><span className="text-foreground font-semibold font-sans">~${result.summary.transportCost}</span> transport</span>}
            {result.summary.totalCost != null && <span className="text-neutral-500 pl-5"><span className="text-[--color-rampage] font-bold font-sans">~${result.summary.totalCost}</span> total</span>}
          </div>
        </div>
      </div>

      {/* Game detail popover — shared component matching home page */}
      {popoverGameId && (() => {
        const game = result.games.find((g) => g.id === popoverGameId);
        if (!game) return null;
        const popoverGame: GameEvent = {
          ...game,
          url: `https://www.ticketmaster.com/event/${game.id}`,
          lat: game.lat,
          lng: game.lng,
        };
        return (
          <GameDetailPopover
            game={popoverGame}
            visible={popoverVisible}
            onClose={closePopover}
            date={game.est_date}
            userLocation={null}
          />
        );
      })()}
    </div>
  );
}

/** Render a single itinerary's legs vertically inside a card */
function ItinLegs({ itin }: { itin: Itinerary }) {
  return (
    <div className="flex flex-col gap-0.5 mt-1 min-w-0">
      {itin.legs.map((l, li) => (
        <div key={li} className="py-1 px-1.5 min-w-0">
          <a href={l.bookingUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs hover:bg-neutral-100 rounded-lg transition-colors no-underline min-w-0">
            <span className={`shrink-0 ${modeColor(l.mode)}`}>{modeIcon(l.mode)}</span>
            <span className="text-neutral-500 truncate min-w-0">
              {l.carrier && l.routeName && l.mode !== "drive" && l.mode !== "rideshare"
                ? <><span className="text-foreground font-medium">{l.carrier}</span> <span className="text-neutral-400 text-[9px]">{l.routeName}</span></>
                : modeLabel(l.mode)}
            </span>
            <span className="flex items-baseline gap-1.5 shrink-0 ml-auto">
              <span className="text-foreground font-semibold">{formatDuration(l.minutes)}</span>
              {l.miles > 0 && <span className="text-neutral-400 text-[9px]">{l.miles}mi</span>}
              {l.cost != null && <span className="text-[--color-price] font-semibold">${l.cost}</span>}
              <ArrowUpRight className="size-3 text-neutral-400" />
            </span>
          </a>
          <div className="text-[9px] text-neutral-400 ml-6 leading-tight truncate">
            {l.mode === "drive" || l.mode === "rideshare" ? `Drive to ${l.to}` : `${l.from} → ${l.to}`}
          </div>
          {(l.mode === "drive" || l.mode === "rideshare") && (
            <div className="flex items-center gap-2 ml-6 mt-0.5 text-[10px]">
              <a href={`https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${l.fromLat}&pickup[longitude]=${l.fromLng}&dropoff[latitude]=${l.toLat}&dropoff[longitude]=${l.toLng}`} target="_blank" rel="noopener noreferrer" className="text-neutral-900 font-medium hover:opacity-70 transition-opacity no-underline">Uber</a>
              <a href={`https://ride.lyft.com/ridetype?pickup[latitude]=${l.fromLat}&pickup[longitude]=${l.fromLng}&destination[latitude]=${l.toLat}&destination[longitude]=${l.toLng}`} target="_blank" rel="noopener noreferrer" className="text-[#FF00BF] font-medium hover:opacity-70 transition-opacity no-underline">Lyft</a>
            </div>
          )}
        </div>
      ))}
      {itin.totalCost != null && (
        <div className="text-xs text-[--color-price] font-semibold mt-1 px-1.5">${itin.totalCost} total</div>
      )}
    </div>
  );
}

/** Label for an itinerary card based on its primary mode */
function itinLabel(itin: Itinerary): { icon: React.ReactNode; label: string; color: string } {
  const hasFlight = itin.legs.some(l => l.mode === "flight");
  const hasBus = itin.legs.some(l => l.mode === "bus");
  const hasTrain = itin.legs.some(l => l.mode === "train");
  if (hasFlight) return { icon: <Plane className="size-4" />, label: "Fly", color: "text-[--color-flight]" };
  if (hasTrain) return { icon: <TrainFront className="size-4" />, label: "Train", color: "text-[--color-train]" };
  if (hasBus) return { icon: <BusFront className="size-4" />, label: "Bus", color: "text-[--color-bus]" };
  return { icon: <Car className="size-4" />, label: "Drive", color: "text-[--color-drive]" };
}

/** Stacked card — shows multiple itineraries of the same mode with vertical swipe to cycle */
function StackedItinCard({ itineraries }: { itineraries: Itinerary[] }) {
  const [idx, setIdx] = useState(0);
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const count = itineraries.length;
  const itin = itineraries[idx];
  const { icon, label, color } = itinLabel(itin);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    const dx = Math.abs(e.changedTouches[0].clientX - touchStartX.current);
    // Only trigger vertical swipe if vertical distance > horizontal (avoid blocking horizontal scroll)
    if (Math.abs(dy) < 30 || dx > Math.abs(dy)) return;
    if (dy < 0 && idx < count - 1) setIdx(idx + 1);
    if (dy > 0 && idx > 0) setIdx(idx - 1);
  }

  return (
    <div
      className="shrink-0 w-[260px] snap-start relative"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Stack shadow cards behind */}
      {count > 1 && idx < count - 1 && (
        <>
          <div className="absolute inset-x-[6px] top-[6px] bottom-[-6px] rounded-2xl bg-neutral-100/80" />
          {idx < count - 2 && (
            <div className="absolute inset-x-[12px] top-[12px] bottom-[-12px] rounded-2xl bg-neutral-100/40" />
          )}
        </>
      )}

      {/* Active card */}
      <div className="relative rounded-2xl bg-neutral-50 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className={color}>{icon}</span>
          <span className="text-xs font-semibold text-foreground">{label}</span>
          {count > 1 && (
            <span className="flex items-center gap-0.5 text-[10px] text-neutral-400 ml-1">
              <button
                onClick={() => setIdx(Math.max(0, idx - 1))}
                disabled={idx === 0}
                className="p-0 disabled:opacity-20"
              >
                <ChevronUp className="size-3" />
              </button>
              <span className="tabular-nums">{idx + 1}/{count}</span>
              <button
                onClick={() => setIdx(Math.min(count - 1, idx + 1))}
                disabled={idx === count - 1}
                className="p-0 disabled:opacity-20"
              >
                <ChevronDown className="size-3" />
              </button>
            </span>
          )}
          <span className="text-xs text-neutral-400 ml-auto">{formatDuration(itin.totalMinutes)}</span>
        </div>
        <ItinLegs itin={itin} />
      </div>
    </div>
  );
}

/** Travel leg — horizontally scrollable option cards, stacked when multiple of same mode */
function TravelLegCard({ leg, cheapest }: { leg: RampageLeg; cheapest: Itinerary | null }) {
  if (!cheapest) return null;
  const t = leg.transitOption;

  // Group itineraries by primary mode
  const groups = new Map<string, Itinerary[]>();
  for (const itin of leg.itineraries) {
    const { label } = itinLabel(itin);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(itin);
  }

  const cards: React.ReactNode[] = [];
  const seenModes = new Set<string>();

  for (const [label, itins] of groups) {
    seenModes.add(label);
    cards.push(<StackedItinCard key={label} itineraries={itins} />);
  }

  // Google Flights fallback if no flight itinerary
  if (!seenModes.has("Fly")) {
    const flightsUrl = leg.googleFlightsUrl ?? `https://www.google.com/travel/flights?q=Flights+from+${leg.from.lat},${leg.from.lng}+to+${leg.to.lat},${leg.to.lng}+on+${leg.date}`;
    cards.push(
      <a key="fly-link" href={flightsUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-[260px] rounded-2xl bg-neutral-50 px-4 py-3.5 snap-start no-underline hover:bg-neutral-100 transition-colors">
        <div className="flex items-center gap-2">
          <Plane className="size-4 text-[--color-flight]" />
          <span className="text-xs font-semibold text-foreground">Fly</span>
        </div>
        <div className="text-xs text-neutral-500 mt-2">
          {leg.originAirportCode && leg.destAirportCode
            ? `Search ${leg.originAirportCode} → ${leg.destAirportCode}`
            : "Search flights on Google"}
        </div>
        <div className="flex items-center gap-1 text-xs text-neutral-400 mt-1.5">
          <span>Google Flights</span>
          <ArrowUpRight className="size-3" />
        </div>
      </a>
    );
  }

  // Google Transit card
  if (t) {
    cards.push(
      <a key="transit" href={t.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-[260px] rounded-2xl bg-neutral-50 px-4 py-3.5 snap-start no-underline hover:bg-neutral-100 transition-colors">
        <div className="flex items-center gap-2">
          <Bus className="size-4 text-[--color-transit]" />
          <span className="text-xs font-semibold text-foreground">Google Transit</span>
          <span className="text-xs text-neutral-400 ml-auto">{formatDuration(t.transitMinutes)}</span>
        </div>
        <div className="text-xs text-neutral-500 mt-2">Public transit via Google Maps</div>
        {t.transitFare && <div className="text-xs text-[--color-price] font-semibold mt-1.5">{t.transitFare}</div>}
      </a>
    );
  }

  return (
    <div className="my-2.5">
      <div className="flex items-center gap-2 text-xs text-neutral-500 mb-2 px-1">
        <span className="font-semibold text-foreground">{leg.from.name}</span>
        <ArrowRight className="size-3 text-[--color-rampage]" />
        <span className="font-semibold text-foreground">{leg.to.name}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-3">
        {cards}
      </div>
    </div>
  );
}
