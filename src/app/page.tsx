"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouteFocus, VenueInfo } from "@/components/game-map";
import { BottomTray } from "@/components/bottom-tray";
import { LocationButton } from "@/components/location-button";
import { RampageProvider, useRampage } from "@/lib/rampage-context";
import { RampageButton } from "@/components/rampage-button";

const GameMap = dynamic(
  () => import("@/components/game-map").then((m) => m.GameMap),
  { ssr: false }
);

interface GameEvent {
  id: string;
  name: string;
  url: string;
  est_date: string;
  est_time: string | null;
  venue: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  min_price: { amount: number; currency: string } | null;
  status: string;
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
  nearbyAirports?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
  nearbyTrainStations?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
}

interface DateGroup {
  date: string;
  events: GameEvent[];
}

interface AirportCoord {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface EventsResponse {
  total: number;
  date_count: number;
  dates: DateGroup[];
  allAirports?: AirportCoord[];
  updated_at: string;
}

function todayEST(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

const LS_KEY = "balltastic_state";

function loadState(): { date?: string; search?: string; tray?: "collapsed" | "peek" | "expanded"; loc?: { lat: number; lng: number } } {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch { return {}; }
}

function saveState(patch: Record<string, unknown>) {
  try {
    const prev = loadState();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch { /* ignore */ }
}

export default function Home() {
  return (
    <RampageProvider>
      <HomeInner />
    </RampageProvider>
  );
}

function HomeInner() {
  const rampage = useRampage();
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(() => loadState().date ?? todayEST());
  const [search, setSearch] = useState(() => loadState().search ?? "");
  const [selectedVenue, setSelectedVenue] = useState<VenueInfo | null>(null);
  const [hoveredVenue, setHoveredVenue] = useState<string | null>(null);
  const [routeFocus, setRouteFocus] = useState<RouteFocus | null>(null);
  const [trayState, setTrayState] = useState<"collapsed" | "peek" | "expanded">(() => {
    const saved = loadState().tray;
    // Migrate old "half" to "peek"
    if (saved === "half" as string) return "peek";
    return saved ?? "collapsed";
  });
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(() => loadState().loc ?? null);
  const [vh, setVh] = useState(800);

  // Persist state changes
  useEffect(() => { saveState({ date: currentDate }); }, [currentDate]);
  useEffect(() => { saveState({ search }); }, [search]);
  useEffect(() => { saveState({ tray: trayState }); }, [trayState]);
  useEffect(() => { saveState({ loc: userLocation }); }, [userLocation]);

  // Track viewport height
  useEffect(() => {
    setVh(window.innerHeight);
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Request geolocation on page load
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }, []);

  // Fetch data
  useEffect(() => {
    fetch("/api/events")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || "Failed to fetch events");
        }
        return res.json();
      })
      .then((d: EventsResponse) => {
        setData(d);
        const today = todayEST();
        const available = d.dates.map((g) => g.date);
        if (!available.includes(today) && available.length > 0) {
          const future = available.find((date) => date >= today);
          setCurrentDate(future ?? available[0]);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const availableDates = useMemo(
    () => data?.dates.map((g) => g.date) ?? [],
    [data]
  );

  const gameCountByDate = useMemo(() => {
    const map: Record<string, number> = {};
    data?.dates.forEach((g) => {
      map[g.date] = g.events.length;
    });
    return map;
  }, [data]);

  const todayGames = useMemo(() => {
    const group = data?.dates.find((g) => g.date === currentDate);
    if (!group) return [];
    if (!search) return group.events;
    const q = search.toLowerCase();
    return group.events.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.venue.toLowerCase().includes(q) ||
        e.city.toLowerCase().includes(q) ||
        e.state.toLowerCase().includes(q)
    );
  }, [data, currentDate, search]);

  const handleDateChange = useCallback((date: string) => {
    setCurrentDate(date);
    setSelectedVenue(null);
    setRouteFocus(null);
    // Keep tray open when changing dates
  }, []);

  const handleMarkerClick = useCallback((venue: VenueInfo) => {
    // RAMPAGE mode: toggle the first game at this venue
    if (rampage.active) {
      const game = todayGames.find(
        (g) => g.venue === venue.venue && g.lat != null && g.lng != null && g.est_date
      );
      if (game) {
        const wasSelected = game.est_date && rampage.selectedGames.has(game.est_date) && rampage.selectedGames.get(game.est_date)!.id === game.id;
        rampage.toggleGame({
          id: game.id,
          name: game.name,
          venue: game.venue,
          city: game.city,
          state: game.state,
          lat: game.lat!,
          lng: game.lng!,
          est_date: game.est_date!,
          est_time: game.est_time,
          min_price: game.min_price,
          espn_price: game.espn_price,
          odds: game.odds,
          away_record: game.away_record,
          home_record: game.home_record,
        });
        if (!wasSelected) {
          setUserLocation({ lat: game.lat!, lng: game.lng! });
          const idx = availableDates.indexOf(currentDate);
          if (idx >= 0 && idx < availableDates.length - 1) {
            setTimeout(() => setCurrentDate(availableDates[idx + 1]), 300);
          }
        }
      }
      return;
    }
    setSelectedVenue(venue);
    setRouteFocus(null);
    setTrayState("peek");
  }, [rampage, todayGames, availableDates, currentDate]);

  const handleRouteFocus = useCallback((focus: RouteFocus | null) => {
    setRouteFocus(focus);
  }, []);

  const handleTrayStateChange = useCallback((state: "collapsed" | "peek" | "expanded") => {
    setTrayState(state);
    if (state === "collapsed") {
      setRouteFocus(null);
    }
  }, []);

  // Capture pre-rampage state for cancel/restore
  const preRampageRef = useRef<{ location: { lat: number; lng: number } | null; date: string } | null>(null);

  useEffect(() => {
    if (rampage.active && !preRampageRef.current) {
      preRampageRef.current = { location: userLocation, date: currentDate };
    } else if (!rampage.active) {
      preRampageRef.current = null;
    }
  }, [rampage.active]);

  const handleCancelRampage = useCallback(() => {
    if (preRampageRef.current) {
      setUserLocation(preRampageRef.current.location);
      setCurrentDate(preRampageRef.current.date);
      preRampageRef.current = null;
    }
    rampage.toggleRampage();
  }, [rampage]);

  const showOdds = useMemo(() => {
    const today = new Date(todayEST() + "T00:00:00");
    const selected = new Date(currentDate + "T00:00:00");
    const diffDays = Math.round((selected.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 3;
  }, [currentDate]);

  const bottomPadding = trayState === "collapsed" ? 56 : trayState === "peek" ? Math.round(vh * 0.5) : vh;

  return (
    <main className="relative h-dvh w-dvw overflow-hidden">
      {/* Full-page map */}
      <GameMap
        events={todayGames}
        routeFocus={routeFocus}
        selectedVenue={selectedVenue?.venue ?? null}
        onMarkerClick={handleMarkerClick}
        onMarkerHover={setHoveredVenue}
        hoveredVenue={hoveredVenue}
        userLocation={userLocation}
        bottomPadding={bottomPadding}
        rampageActive={rampage.active}
        rampageGames={rampage.sortedGames}
        rampageStart={rampage.startLocation}
        rampageEnd={rampage.endLocation}
      />

      {/* Location button — floating top right */}
      {trayState !== "expanded" && (
        <LocationButton userLocation={userLocation} onLocationChange={setUserLocation} />
      )}

      {/* Rampage button — floating top left */}
      {trayState !== "expanded" && (
        <RampageButton userLocation={userLocation} onCancelRampage={handleCancelRampage} />
      )}

      {/* Bottom tray — intel panel */}
      {data && (
        <BottomTray
          games={todayGames}
          date={currentDate}
          selectedVenue={selectedVenue?.venue ?? null}
          hoveredVenue={hoveredVenue}
          onVenueHover={setHoveredVenue}
          onVenueClick={handleMarkerClick}
          onRouteFocus={handleRouteFocus}
          trayState={trayState}
          onTrayStateChange={handleTrayStateChange}
          userLocation={userLocation}
          allAirports={data.allAirports ?? []}
          showOdds={showOdds}
          search={search}
          onSearchChange={setSearch}
          availableDates={availableDates}
          onDateChange={handleDateChange}
          gameCountByDate={gameCountByDate}
          onLocationChange={setUserLocation}
        />
      )}

      {/* Loading overlay — dark */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]/90">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[--primary]/30 border-t-[--primary] rounded-full animate-spin" />
          </div>
        </div>
      )}

      {/* Error overlay — dark */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]/90">
          <div className="panel rounded-lg p-6 max-w-md text-center">
            <p className="font-mono font-semibold text-[--color-danger] mb-2 tracking-widest">ERROR</p>
            <p className="text-sm text-[--color-dim]">{error}</p>
            <p className="text-xs text-[--color-dim]/60 mt-3 font-mono">
              Check that TICKETMASTER_API_KEY is set in .env.local
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
