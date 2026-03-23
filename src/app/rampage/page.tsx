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
  Hotel,
  ArrowUpRight,
  Loader2,
  Share2,
  Star,
  Clock,
  Ticket,
  AlertTriangle,
  ShieldCheck,
  Check,
  Ban,
} from "lucide-react";
import Link from "next/link";
import type { VenuePolicy } from "@/lib/venue-policies";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(time: string | null, tz?: string | null): string {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period} ${tz ?? "ET"}`;
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

// ── Page ───────────────────────────────────────────────────────────────────

export default function RampagePage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 className="size-8 text-[--color-rampage] animate-spin" />
      </div>
    }>
      <RampageContent />
    </Suspense>
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
  const [venuePolicies, setVenuePolicies] = useState<Record<string, VenuePolicy>>({});

  // Load cow from localStorage, falling back to DB for shared links
  useEffect(() => {
    if (!cowId) {
      setError("No rampage ID provided");
      setLoading(false);
      return;
    }

    // Try localStorage first
    try {
      const raw = localStorage.getItem(`balltastic_cow_${cowId}`);
      if (raw) {
        setCow(JSON.parse(raw));
        return;
      }
    } catch { /* fall through to API */ }

    // Fetch from DB (shared link)
    fetch(`/api/cow?id=${encodeURIComponent(cowId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: SavedCow) => {
        setCow(data);
        // Cache locally for future visits
        try {
          localStorage.setItem(`balltastic_cow_${cowId}`, JSON.stringify(data));
        } catch { /* ignore */ }
      })
      .catch(() => {
        setError("Rampage plan not found");
        setLoading(false);
      });
  }, [cowId]);

  // Fetch routes once cow is loaded
  useEffect(() => {
    if (!cow) return;

    async function fetchRampage() {
      try {
        const res = await fetch("/api/rampage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startLocation: cow!.startLocation,
            endLocation: cow!.endLocation,
            games: cow!.games.map((g) => ({
              venue: g.venue,
              lat: g.lat,
              lng: g.lng,
              date: g.est_date,
              time: g.est_time ?? "19:00",
              name: g.name,
              min_price: g.min_price,
              espn_price: g.espn_price,
            })),
          }),
        });
        if (!res.ok) throw new Error("Failed to fetch rampage plan");
        const data: RampageResult = await res.json();
        // Merge saved game data (odds, records) back in since API doesn't have it
        data.games = cow!.games;
        setResult(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchRampage();
  }, [cow]);

  // Fetch venue policies for all games
  useEffect(() => {
    if (!result) return;
    const venues = [...new Set(result.games.map((g) => g.venue))];
    for (const venue of venues) {
      if (venuePolicies[venue]) continue;
      fetch(`/api/venue-policy?venue=${encodeURIComponent(venue)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: VenuePolicy | null) => {
          if (data) setVenuePolicies((prev) => ({ ...prev, [venue]: data }));
        })
        .catch(() => {});
    }
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  // Init map
  useEffect(() => {
    if (!result || !mapRef.current || googleMapRef.current) return;

    async function initMap() {
      setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "", v: "weekly" });
      await Promise.all([importLibrary("maps"), importLibrary("marker")]);
      if (!mapRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: 39.8, lng: -98.5 },
        zoom: 4,
        mapId: "rampage_map",
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
        colorScheme: "DARK" as unknown as google.maps.ColorScheme,
      });
      googleMapRef.current = map;

      const bounds = new google.maps.LatLngBounds();
      const points: { lat: number; lng: number }[] = [];

      // Start marker
      if (cow) {
        const startEl = document.createElement("div");
        startEl.style.cssText = "width:20px;height:20px;border-radius:50%;background:#22c55e;border:2px solid white;box-shadow:0 2px 8px rgba(34,197,94,0.5);";
        new google.maps.marker.AdvancedMarkerElement({ map, position: cow.startLocation, content: startEl });
        bounds.extend(cow.startLocation);
        points.push(cow.startLocation);
      }

      // Game markers (numbered)
      result!.games.forEach((game, i) => {
        const el = document.createElement("div");
        el.style.cssText = `width:28px;height:28px;border-radius:50%;background:#f97316;color:white;font-family:monospace;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 8px rgba(249,115,22,0.5);`;
        el.textContent = String(i + 1);
        new google.maps.marker.AdvancedMarkerElement({ map, position: { lat: game.lat, lng: game.lng }, content: el });
        bounds.extend({ lat: game.lat, lng: game.lng });
        points.push({ lat: game.lat, lng: game.lng });
      });

      // End marker
      if (cow) {
        const endEl = document.createElement("div");
        endEl.style.cssText = "width:20px;height:20px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 2px 8px rgba(239,68,68,0.5);";
        new google.maps.marker.AdvancedMarkerElement({ map, position: cow.endLocation, content: endEl });
        bounds.extend(cow.endLocation);
        points.push(cow.endLocation);
      }

      // Connecting polyline
      if (points.length >= 2) {
        new google.maps.Polyline({
          path: points,
          geodesic: true,
          strokeColor: "#f97316",
          strokeOpacity: 0.7,
          strokeWeight: 3,
          map,
        });
      }

      map.fitBounds(bounds, { top: 20, right: 20, bottom: 20, left: 20 });
    }

    initMap();
  }, [result, cow]);

  function handleShare() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      alert("Link copied to clipboard!");
    });
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-[#0a0a0f] flex flex-col items-center justify-center gap-4">
        <div className="panel-elevated rounded-xl px-8 py-6 flex flex-col items-center gap-3">
          <p className="font-mono text-[--color-danger] tracking-widest">ERROR</p>
          <p className="text-sm text-[--color-dim]">{error}</p>
          <Link href="/" className="text-sm text-[--color-rampage] hover:underline font-mono">
            <ArrowLeft className="size-4 inline mr-1" />BACK TO MAP
          </Link>
        </div>
      </div>
    );
  }

  if (loading || !result || !cow) {
    return (
      <div className="min-h-dvh bg-[#0a0a0f] flex flex-col items-center justify-center gap-3">
        <div className="panel-elevated rounded-xl px-8 py-6 flex flex-col items-center gap-3">
          <Loader2 className="size-8 text-[--color-rampage] animate-spin" />
          <p className="text-sm text-[--color-dim] font-mono">QMBOing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0a0a0f] text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-20 panel-elevated border-b border-white/10">
        <div className="flex items-center gap-3 px-4 py-3 max-w-4xl mx-auto">
          <Link href="/" className="text-[--color-dim] hover:text-foreground transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <Zap className="size-5 text-[--color-rampage]" />
          <h1 className="font-mono font-bold tracking-wider text-[--color-rampage] flex-1">RAMPAGE</h1>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-[--color-dim] hover:text-foreground panel-inset hover:bg-white/[0.06] transition-colors"
          >
            <Share2 className="size-3.5" /> SHARE
          </button>
        </div>
      </div>

      {/* Tight-time warning banner */}
      {(() => {
        const now = Date.now();
        const tight: { index: number; game: string }[] = [];
        result.games.forEach((game, i) => {
          const leg = result.legs[i];
          if (!leg) return;
          const cheapest = leg.itineraries.length
            ? leg.itineraries.reduce((a, b) => (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b)
            : null;
          if (!cheapest) return;
          const timeStr = game.est_time ?? "19:00";
          // Approximate ET offset: Mar–Nov → EDT (UTC-4), else EST (UTC-5)
          const month = new Date(game.est_date + "T12:00:00Z").getMonth();
          const offset = month >= 2 && month <= 10 ? "-04:00" : "-05:00";
          const gameStart = new Date(`${game.est_date}T${timeStr}:00${offset}`);
          const minutesAvailable = Math.floor((gameStart.getTime() - now) / 60000);
          if (minutesAvailable > 0 && cheapest.totalMinutes > minutesAvailable) {
            const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
            const label = parts.length > 1 ? `Game ${i + 1}` : game.name;
            tight.push({ index: i + 1, game: label });
          }
        });
        if (tight.length === 0) return null;
        return (
          <div className="panel border-b border-amber-500/20 px-4 py-2.5 bg-amber-500/5">
            <div className="max-w-4xl mx-auto flex items-start gap-2.5">
              <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs font-mono text-amber-300/90">
                <span className="font-semibold text-amber-400">TIGHT SCHEDULE</span>
                <span className="text-amber-300/70"> — Travel time exceeds time until tipoff for {tight.map((t) => `Game ${t.index}`).join(", ")}. These legs may not be possible.</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Map */}
      <div className="max-w-4xl mx-auto px-4 pt-4">
        <div ref={mapRef} className="w-full h-[300px] sm:h-[400px] rounded-xl overflow-hidden ring-1 ring-white/10" />
      </div>

      {/* Timeline */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-3">
        {/* Start card */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl panel-elevated">
          <div className="size-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
            <MapPin className="size-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-[10px] font-mono text-emerald-400/70 tracking-widest">START</div>
            <div className="text-sm font-semibold">{cow.startLocation.label}</div>
          </div>
        </div>

        {/* Legs and games */}
        {result.games.map((game, i) => {
          const leg = result.legs[i];
          const hotels = result.hotels.find((h) => h.date === game.est_date);
          const cheapest = leg?.itineraries.length
            ? leg.itineraries.reduce((a, b) => (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b)
            : null;

          // Parse team names
          const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
          const home = parts[0].replace(/\s*\(.*?\)/g, "").trim();
          const away = parts.length > 1 ? parts.slice(1).join(" vs ").replace(/\s*\(.*?\)/g, "").trim() : null;
          const price = game.espn_price?.amount ?? game.min_price?.amount;
          const spread = game.odds ? Math.abs(game.odds.away_win - game.odds.home_win) : null;
          const isCloseOdds = spread != null && spread <= 10;

          return (
            <div key={game.id}>
              {/* Travel leg */}
              <TravelLegCard leg={leg} cheapest={cheapest} />

              {/* Game card — matches home page style */}
              <div className="rounded-xl panel-elevated overflow-hidden">
                <div className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    {/* Number badge */}
                    <div className="size-8 rounded-full bg-[--color-rampage]/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="font-mono text-sm font-bold text-[--color-rampage]">{i + 1}</span>
                    </div>

                    {/* Game info */}
                    <div className="flex-1 min-w-0">
                      {/* Date + time */}
                      <div className="flex items-center gap-2 text-[10px] font-mono text-[--color-dim] tracking-widest mb-1">
                        <span>{formatDate(game.est_date)}</span>
                        <span>·</span>
                        <Clock className="size-3" />
                        <span>{formatTime(game.local_time ?? game.est_time, game.tz)}</span>
                      </div>

                      {/* Teams with records */}
                      {away ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold uppercase text-foreground truncate">{away}</span>
                            {game.away_record && (
                              <span className="text-xs font-mono text-[--color-dim] tabular-nums">{game.away_record}</span>
                            )}
                            {game.odds && (
                              <span className={`text-xs font-mono tabular-nums ${isCloseOdds ? "text-[#facc15] font-semibold" : "text-[--color-dim]"}`}>
                                {game.odds.away_win}%
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold uppercase text-foreground truncate">
                              <span className="text-[--color-rampage]/60 font-normal mr-1">@</span>{home}
                            </span>
                            {game.home_record && (
                              <span className="text-xs font-mono text-[--color-dim] tabular-nums">{game.home_record}</span>
                            )}
                            {game.odds && (
                              <span className={`text-xs font-mono tabular-nums ${isCloseOdds ? "text-[#facc15] font-semibold" : "text-[--color-dim]"}`}>
                                {game.odds.home_win}%
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm font-semibold uppercase text-foreground truncate">{game.name}</div>
                      )}

                      {/* Venue */}
                      <div className="text-[11px] font-mono text-[--color-dim] mt-1 truncate">
                        {game.venue} · {game.city}, {game.state}
                      </div>
                    </div>

                    {/* Price */}
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      {price != null && (
                        <span className={`font-mono text-lg font-semibold ${price < 30 ? "text-emerald-400" : price < 80 ? "text-emerald-300/80" : "text-foreground"}`}>
                          ${price}
                        </span>
                      )}
                      {game.espn_price?.available != null && game.espn_price.available > 0 && (
                        <span className="font-mono text-[10px] text-[--color-dim]">{game.espn_price.available} avail</span>
                      )}
                      {game.odds && spread != null && (
                        <span className={`font-mono text-[10px] ${isCloseOdds ? "text-[#facc15]" : "text-[--color-dim]"}`}>
                          ±{spread} spread
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Links row */}
                <div className="flex items-center gap-3 px-4 py-2 border-t border-white/8 text-[11px] font-mono">
                  <a href={`https://www.ticketmaster.com/event/${game.id}`} target="_blank" rel="noopener noreferrer" className="text-[--color-rampage]/70 hover:text-[--color-rampage] inline-flex items-center gap-0.5 transition-colors">
                    TICKETMASTER <ArrowUpRight className="size-2.5" />
                  </a>
                  {game.espn_price?.url && (
                    <a href={game.espn_price.url} target="_blank" rel="noopener noreferrer" className="text-[--color-rampage]/70 hover:text-[--color-rampage] inline-flex items-center gap-0.5 transition-colors">
                      VIVIDSEATS <ArrowUpRight className="size-2.5" />
                    </a>
                  )}
                  {game.odds && (
                    <a href={`https://kalshi.com/markets/KXNBAGAME/${game.odds.kalshi_event}`} target="_blank" rel="noopener noreferrer" className="text-[--color-rampage]/70 hover:text-[--color-rampage] inline-flex items-center gap-0.5 transition-colors">
                      KALSHI <ArrowUpRight className="size-2.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Venue policy */}
              {(() => {
                const policy = venuePolicies[game.venue];
                if (!policy) return null;
                const allowed = policy.items.filter((i) => i.allowed);
                const prohibited = policy.items.filter((i) => !i.allowed);
                return (
                  <div className="mt-2 rounded-xl panel-inset px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-[--color-rampage]/70 tracking-widest mb-1.5">
                      <ShieldCheck className="size-3" /> VENUE POLICY
                    </div>
                    <div className="text-[11px] font-mono text-[--color-dim]">
                      {policy.clearBagRequired && (
                        <span className="text-amber-400 font-semibold">Clear bag required</span>
                      )}
                      {policy.maxBagSize && (
                        <span>{policy.clearBagRequired ? " · " : ""}Max {policy.maxBagSize}</span>
                      )}
                    </div>
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
                    {policy.policyUrl && (
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
                );
              })()}

              {/* Hotel suggestions */}
              {hotels && hotels.suggestions.length > 0 && (
                <div className="mt-2 rounded-xl panel-inset px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-400/70 tracking-widest mb-1.5">
                    <Hotel className="size-3" /> NEARBY HOTELS
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {hotels.suggestions.map((h, hi) => (
                      <div
                        key={hi}
                        className="flex flex-col gap-1 text-[11px] font-mono rounded-lg panel px-2.5 py-2 min-w-[12rem] shrink-0"
                      >
                        <a href={h.bookingUrl} target="_blank" rel="noopener noreferrer" className="hover:text-amber-400 transition-colors">
                          <span className="text-xs font-semibold text-foreground truncate block">{h.name}</span>
                        </a>
                        <div className="flex items-center gap-2">
                          {h.rating && (
                            <span className="flex items-center gap-0.5 text-amber-400">
                              <Star className="size-2.5" /> {h.rating}
                            </span>
                          )}
                          <span className="text-emerald-400">{h.estimatedPrice}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-[--color-dim] border-t border-white/8 pt-1 mt-0.5">
                          <MapPin className="size-2.5 text-amber-400/60 shrink-0" />
                          <span className="text-foreground">{h.distanceMiles} mi from {hotels.venue}</span>
                          <span>·</span>
                          <Car className="size-2.5 shrink-0" />
                          <span>{h.driveMinutes} min</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-[--color-dim]">
                          <span>UBER <span className="text-emerald-400">{h.uberEstimate}</span></span>
                          <span>LYFT <span className="text-emerald-400">{h.lyftEstimate}</span></span>
                        </div>
                        <a
                          href={h.directionsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-cyan-400/70 hover:text-cyan-400 inline-flex items-center gap-0.5 transition-colors"
                        >
                          DIRECTIONS <ArrowUpRight className="size-2.5" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Final leg (last game → end) */}
        {result.legs.length > result.games.length && (() => {
          const finalLeg = result.legs[result.legs.length - 1];
          const cheapest = finalLeg?.itineraries.length
            ? finalLeg.itineraries.reduce((a, b) => (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b)
            : null;
          return <TravelLegCard leg={finalLeg} cheapest={cheapest} />;
        })()}

        {/* End card */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl panel-elevated">
          <div className="size-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
            <MapPin className="size-4 text-red-400" />
          </div>
          <div>
            <div className="text-[10px] font-mono text-red-400/70 tracking-widest">END</div>
            <div className="text-sm font-semibold">{cow.endLocation.label}</div>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="sticky bottom-0 z-20 panel-elevated border-t border-white/10">
        <div className="flex items-center justify-between px-4 py-3 max-w-4xl mx-auto text-xs font-mono">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-[--color-dim]">
              <span className="text-[--color-rampage] font-semibold">{result.summary.gameCount}</span> GAME{result.summary.gameCount !== 1 ? "S" : ""}
            </span>
            <span className="text-[--color-dim]">
              <span className="text-foreground font-semibold">{formatDuration(result.summary.totalMinutes)}</span> TRAVEL
            </span>
            {result.summary.ticketCost > 0 && (
              <span className="text-[--color-dim]">
                <Ticket className="size-3 inline mr-0.5" />
                <span className="text-emerald-400 font-semibold">${result.summary.ticketCost}</span> TICKETS
              </span>
            )}
            {result.summary.transportCost != null && (
              <span className="text-[--color-dim]">
                <Car className="size-3 inline mr-0.5" />
                <span className="text-emerald-400 font-semibold">~${result.summary.transportCost}</span> TRANSPORT
              </span>
            )}
            {result.summary.totalCost != null && (
              <span className="text-[--color-dim] border-l border-white/10 pl-4">
                <span className="text-[--color-rampage] font-bold">~${result.summary.totalCost}</span> TOTAL
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Travel leg card between two points — vertical stop sequence */
function TravelLegCard({ leg, cheapest }: { leg: RampageLeg; cheapest: Itinerary | null }) {
  if (!cheapest) return null;

  const t = leg.transitOption;

  return (
    <div className="my-2 rounded-xl panel-inset px-4 py-3">
      {/* Summary header */}
      <div className="flex items-center gap-2 text-[11px] font-mono text-[--color-dim] mb-2">
        <span className="text-foreground font-semibold">{leg.from.name}</span>
        <ArrowRight className="size-3 text-[--color-rampage]" />
        <span className="text-foreground font-semibold">{leg.to.name}</span>
        <span className="text-[--color-dim] ml-auto">{formatDuration(cheapest.totalMinutes)}</span>
        {cheapest.totalCost != null && (
          <span className="text-emerald-400">${cheapest.totalCost}</span>
        )}
      </div>

      {/* Vertical stop sequence */}
      <div className="flex flex-col ml-1">
        {cheapest.legs.map((l, li) => {
          const isLast = li === cheapest.legs.length - 1 && !t;
          return (
            <div key={li} className="flex items-stretch gap-0">
              {/* Dot + connector line */}
              <div className="flex flex-col items-center w-4 shrink-0">
                <div className="size-2 rounded-full bg-[--color-rampage]/60 mt-[7px] shrink-0" />
                {!isLast && <div className="w-px flex-1 bg-[--color-rampage]/20" />}
              </div>
              {/* Leg content */}
              <div className="flex flex-col pb-1 min-w-0 flex-1">
                <a
                  href={l.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[11px] font-mono py-1 hover:bg-white/[0.03] rounded px-1.5 -ml-0.5 transition-colors no-underline"
                >
                  <span className="shrink-0">{modeIcon(l.mode)}</span>
                  <span className="text-[--color-dim] shrink-0 w-12">{modeLabel(l.mode)}</span>
                  <span className="text-foreground shrink-0">{formatDuration(l.minutes)}</span>
                  {l.miles > 0 && <span className="text-[--color-dim] shrink-0">{l.miles}mi</span>}
                  {l.cost != null && <span className="text-emerald-400 shrink-0">${l.cost}</span>}
                  <span className="text-[--color-dim]/50 truncate text-[10px]">{l.from} → {l.to}</span>
                  <ArrowUpRight className="size-2.5 text-[--color-dim] shrink-0 ml-auto" />
                </a>
                {l.uberEstimate && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-[--color-dim] px-1.5 -ml-0.5">
                    <span>UBER <span className="text-emerald-400">{l.uberEstimate}</span></span>
                    {l.lyftEstimate && <span>LYFT <span className="text-emerald-400">{l.lyftEstimate}</span></span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Transit option from Google Directions */}
        {t && (
          <div className="flex items-stretch gap-0">
            <div className="flex flex-col items-center w-4 shrink-0">
              <div className="size-2 rounded-full bg-cyan-400/60 mt-[7px] shrink-0" />
              {(t.uberEstimate || t.lyftEstimate) ? <div className="w-px flex-1 bg-[--color-rampage]/20" /> : null}
            </div>
            <div className="flex flex-col pb-1 min-w-0 flex-1">
              <a
                href={t.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] font-mono py-1 hover:bg-cyan-500/[0.05] rounded px-1.5 -ml-0.5 transition-colors no-underline"
              >
                <Bus className="size-4 text-cyan-400 shrink-0" />
                <span className="text-cyan-400 shrink-0 w-12">Transit</span>
                <span className="text-foreground shrink-0">{formatDuration(t.transitMinutes)}</span>
                {t.transitFare && <span className="text-emerald-400 shrink-0">{t.transitFare}</span>}
                <ArrowUpRight className="size-2.5 text-[--color-dim] shrink-0 ml-auto" />
              </a>
            </div>
          </div>
        )}

        {/* Uber/Lyft estimates */}
        {t && (t.uberEstimate || t.lyftEstimate) && (
          <div className="flex items-stretch gap-0">
            <div className="flex flex-col items-center w-4 shrink-0">
              <div className="size-1.5 rounded-full bg-white/20 mt-[7px] shrink-0" />
            </div>
            <div className="flex items-center gap-3 text-[10px] font-mono text-[--color-dim] py-0.5 px-1.5 -ml-0.5">
              {t.uberEstimate && (
                <span>UBER <span className="text-emerald-400">{t.uberEstimate}</span></span>
              )}
              {t.lyftEstimate && (
                <span>LYFT <span className="text-emerald-400">{t.lyftEstimate}</span></span>
              )}
            </div>
          </div>
        )}

        {/* End dot */}
        <div className="flex items-center gap-0">
          <div className="flex flex-col items-center w-4 shrink-0">
            <div className="size-2 rounded-full bg-[--color-rampage]/60 shrink-0" />
          </div>
        </div>
      </div>
    </div>
  );
}
