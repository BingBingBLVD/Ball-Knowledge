"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import Link from "next/link";
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

interface RampageLeg {
  from: { name: string; lat: number; lng: number };
  to: { name: string; lat: number; lng: number };
  date: string;
  itineraries: Itinerary[];
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
  min_price: { amount: number; currency: string } | null;
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
  summary: { totalCost: number | null; totalMinutes: number; gameCount: number };
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

  // Load cow from localStorage
  useEffect(() => {
    if (!cowId) {
      setError("No rampage ID provided");
      setLoading(false);
      return;
    }
    try {
      const raw = localStorage.getItem(`balltastic_cow_${cowId}`);
      if (!raw) {
        setError("Rampage plan not found");
        setLoading(false);
        return;
      }
      const parsed: SavedCow = JSON.parse(raw);
      setCow(parsed);
    } catch {
      setError("Failed to load rampage plan");
      setLoading(false);
    }
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
            })),
          }),
        });
        if (!res.ok) throw new Error("Failed to fetch rampage plan");
        const data: RampageResult = await res.json();
        setResult(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    fetchRampage();
  }, [cow]);

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
        <p className="font-mono text-[--color-danger] tracking-widest">ERROR</p>
        <p className="text-sm text-[--color-dim]">{error}</p>
        <Link href="/" className="text-sm text-[--color-rampage] hover:underline font-mono">
          <ArrowLeft className="size-4 inline mr-1" />BACK TO MAP
        </Link>
      </div>
    );
  }

  if (loading || !result || !cow) {
    return (
      <div className="min-h-dvh bg-[#0a0a0f] flex flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 text-[--color-rampage] animate-spin" />
        <p className="text-sm text-[--color-dim] font-mono">Planning your rampage...</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0a0a0f] text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-20 panel border-b border-white/5">
        <div className="flex items-center gap-3 px-4 py-3 max-w-4xl mx-auto">
          <Link href="/" className="text-[--color-dim] hover:text-foreground transition-colors">
            <ArrowLeft className="size-5" />
          </Link>
          <Zap className="size-5 text-[--color-rampage]" />
          <h1 className="font-mono font-bold tracking-wider text-[--color-rampage] flex-1">RAMPAGE</h1>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono text-[--color-dim] hover:text-foreground border border-white/10 hover:border-white/20 transition-colors"
          >
            <Share2 className="size-3.5" /> SHARE
          </button>
        </div>
      </div>

      {/* Map */}
      <div ref={mapRef} className="w-full h-[300px] sm:h-[400px]" />

      {/* Timeline */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Start card */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg panel">
          <div className="size-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
            <MapPin className="size-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xs font-mono text-[--color-dim] tracking-widest">START</div>
            <div className="text-sm font-semibold">{cow.startLocation.label}</div>
          </div>
        </div>

        {/* Legs and games */}
        {result.games.map((game, i) => {
          const leg = result.legs[i]; // travel leg TO this game
          const hotels = result.hotels.find((h) => h.date === game.est_date);
          const cheapest = leg?.itineraries.length
            ? leg.itineraries.reduce((a, b) => (a.totalCost ?? Infinity) < (b.totalCost ?? Infinity) ? a : b)
            : null;
          const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
          const away = parts.length > 1 ? parts.slice(1).join(" vs ").replace(/\s*\(.*?\)/g, "").trim() : null;
          const home = parts[0].replace(/\s*\(.*?\)/g, "").trim();

          return (
            <div key={game.id}>
              {/* Travel leg card */}
              {cheapest && (
                <div className="ml-4 border-l-2 border-[--color-rampage]/30 pl-4 py-2">
                  <div className="flex items-center gap-2 text-xs font-mono text-[--color-dim]">
                    <ArrowRight className="size-3" />
                    <span>{leg.from.name}</span>
                    <ArrowRight className="size-3" />
                    <span>{leg.to.name}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {cheapest.legs.map((l, li) => (
                      <div key={li} className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded border border-white/10 bg-white/[0.02]">
                        {modeIcon(l.mode)}
                        <span className="text-[--color-dim]">{modeLabel(l.mode)}</span>
                        <span className="text-foreground">{formatDuration(l.minutes)}</span>
                        {l.cost != null && <span className="text-emerald-400">${l.cost}</span>}
                        {l.bookingUrl && (
                          <a href={l.bookingUrl} target="_blank" rel="noopener noreferrer" className="text-[--color-dim] hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                            <ArrowUpRight className="size-3" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                  {cheapest.totalCost != null && (
                    <div className="mt-1 text-[11px] font-mono text-[--color-dim]">
                      Total: {formatDuration(cheapest.totalMinutes)} · ${cheapest.totalCost}
                    </div>
                  )}
                </div>
              )}

              {/* Game card */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg panel">
                <div className="size-8 rounded-full bg-[--color-rampage]/20 flex items-center justify-center shrink-0">
                  <span className="font-mono text-sm font-bold text-[--color-rampage]">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-[--color-dim] tracking-widest">{formatDate(game.est_date)}</div>
                  <div className="text-sm font-semibold truncate">
                    {away ? `${away} @ ${home}` : game.name}
                  </div>
                  <div className="text-[11px] font-mono text-[--color-dim] truncate">
                    {game.venue} · {game.city}, {game.state}
                    {game.est_time && ` · ${(() => { const [h,m] = game.est_time.split(":").map(Number); const p = h >= 12 ? "PM" : "AM"; return `${h % 12 || 12}:${String(m).padStart(2,"0")} ${p} ET`; })()}`}
                  </div>
                </div>
                {game.min_price && (
                  <div className="text-sm font-mono font-semibold text-emerald-400 shrink-0">
                    ${game.min_price.amount}
                  </div>
                )}
              </div>

              {/* Hotel suggestions */}
              {hotels && hotels.suggestions.length > 0 && (
                <div className="ml-4 border-l-2 border-amber-500/30 pl-4 py-2">
                  <div className="flex items-center gap-1.5 text-xs font-mono text-[--color-dim] mb-1.5">
                    <Hotel className="size-3" /> NEARBY HOTELS
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {hotels.suggestions.map((h, hi) => (
                      <a
                        key={hi}
                        href={h.bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col gap-0.5 text-[11px] font-mono rounded border border-white/5 bg-white/[0.02] px-2.5 py-2 min-w-[10rem] shrink-0 hover:bg-white/[0.04] transition-colors"
                      >
                        <span className="text-xs font-semibold text-foreground truncate">{h.name}</span>
                        <span className="text-[--color-dim] truncate">{h.vicinity}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          {h.rating && (
                            <span className="flex items-center gap-0.5 text-amber-400">
                              <Star className="size-2.5" /> {h.rating}
                            </span>
                          )}
                          <span className="text-emerald-400">{h.estimatedPrice}</span>
                        </div>
                      </a>
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
          return cheapest ? (
            <div className="ml-4 border-l-2 border-[--color-rampage]/30 pl-4 py-2">
              <div className="flex items-center gap-2 text-xs font-mono text-[--color-dim]">
                <ArrowRight className="size-3" />
                <span>{finalLeg.from.name}</span>
                <ArrowRight className="size-3" />
                <span>{finalLeg.to.name}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {cheapest.legs.map((l, li) => (
                  <div key={li} className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded border border-white/10 bg-white/[0.02]">
                    {modeIcon(l.mode)}
                    <span className="text-[--color-dim]">{modeLabel(l.mode)}</span>
                    <span className="text-foreground">{formatDuration(l.minutes)}</span>
                    {l.cost != null && <span className="text-emerald-400">${l.cost}</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : null;
        })()}

        {/* End card */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg panel">
          <div className="size-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
            <MapPin className="size-4 text-red-400" />
          </div>
          <div>
            <div className="text-xs font-mono text-[--color-dim] tracking-widest">END</div>
            <div className="text-sm font-semibold">{cow.endLocation.label}</div>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="sticky bottom-0 z-20 panel border-t border-white/5">
        <div className="flex items-center justify-between px-4 py-3 max-w-4xl mx-auto text-xs font-mono">
          <div className="flex items-center gap-4">
            <span className="text-[--color-dim]">
              <span className="text-[--color-rampage] font-semibold">{result.summary.gameCount}</span> GAMES
            </span>
            <span className="text-[--color-dim]">
              <span className="text-foreground font-semibold">{formatDuration(result.summary.totalMinutes)}</span> TRAVEL
            </span>
            {result.summary.totalCost != null && (
              <span className="text-[--color-dim]">
                <span className="text-emerald-400 font-semibold">~${result.summary.totalCost}</span> EST. COST
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
