"use client";

import { createContext, useCallback, useContext, useMemo, useState, useEffect, type ReactNode } from "react";

export interface SelectedGame {
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

export interface SavedCow {
  id: string;
  createdAt: string;
  startLocation: { lat: number; lng: number; label: string };
  endLocation: { lat: number; lng: number; label: string };
  games: SelectedGame[];
}

interface RampageContextValue {
  active: boolean;
  cowId: string | null;
  startLocation: { lat: number; lng: number; label: string } | null;
  endLocation: { lat: number; lng: number; label: string } | null;
  selectedGames: Map<string, SelectedGame>;
  toggleRampage: (userLocation?: { lat: number; lng: number } | null) => void;
  toggleGame: (game: SelectedGame) => void;
  removeGame: (date: string) => void;
  clearGames: () => void;
  setStartLocation: (loc: { lat: number; lng: number; label: string } | null) => void;
  setEndLocation: (loc: { lat: number; lng: number; label: string } | null) => void;
  saveCow: () => string;
  loadCow: (id: string) => boolean;
  sortedGames: SelectedGame[];
}

const RampageContext = createContext<RampageContextValue | null>(null);

const LS_KEY = "balltastic_rampage";
const COW_PREFIX = "balltastic_cow_";

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function loadSession(): {
  active?: boolean;
  startLocation?: { lat: number; lng: number; label: string } | null;
  endLocation?: { lat: number; lng: number; label: string } | null;
  games?: [string, SelectedGame][];
} {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSession(state: {
  active: boolean;
  startLocation: { lat: number; lng: number; label: string } | null;
  endLocation: { lat: number; lng: number; label: string } | null;
  games: [string, SelectedGame][];
}) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function RampageProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [cowId, setCowId] = useState<string | null>(null);
  const [startLocation, setStartLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [endLocation, setEndLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [selectedGames, setSelectedGames] = useState<Map<string, SelectedGame>>(new Map());

  // Load session from localStorage on mount
  useEffect(() => {
    const saved = loadSession();
    if (saved.active) setActive(true);
    if (saved.startLocation) setStartLocation(saved.startLocation);
    if (saved.endLocation) setEndLocation(saved.endLocation);
    if (saved.games) setSelectedGames(new Map(saved.games));
  }, []);

  // Persist session changes
  useEffect(() => {
    saveSession({
      active,
      startLocation,
      endLocation,
      games: Array.from(selectedGames.entries()),
    });
  }, [active, startLocation, endLocation, selectedGames]);

  const toggleRampage = useCallback((userLocation?: { lat: number; lng: number } | null) => {
    setActive((prev) => {
      const next = !prev;
      if (next && userLocation) {
        const loc = { lat: userLocation.lat, lng: userLocation.lng, label: "Current Location" };
        setStartLocation(loc);
        setEndLocation(loc);
      }
      if (!next) {
        setSelectedGames(new Map());
        setStartLocation(null);
        setEndLocation(null);
        setCowId(null);
      }
      return next;
    });
  }, []);

  const toggleGame = useCallback((game: SelectedGame) => {
    setSelectedGames((prev) => {
      const next = new Map(prev);
      if (next.has(game.est_date) && next.get(game.est_date)!.id === game.id) {
        next.delete(game.est_date);
      } else {
        next.set(game.est_date, game);
      }
      return next;
    });
  }, []);

  const removeGame = useCallback((date: string) => {
    setSelectedGames((prev) => {
      const next = new Map(prev);
      next.delete(date);
      return next;
    });
  }, []);

  const clearGames = useCallback(() => {
    setSelectedGames(new Map());
  }, []);

  const saveCow = useCallback((): string => {
    const id = generateId();
    const cow: SavedCow = {
      id,
      createdAt: new Date().toISOString(),
      startLocation: startLocation ?? { lat: 0, lng: 0, label: "Unknown" },
      endLocation: endLocation ?? { lat: 0, lng: 0, label: "Unknown" },
      games: Array.from(selectedGames.values()).sort(
        (a, b) => a.est_date.localeCompare(b.est_date)
      ),
    };
    try {
      localStorage.setItem(COW_PREFIX + id, JSON.stringify(cow));
    } catch { /* ignore */ }
    setCowId(id);
    return id;
  }, [startLocation, endLocation, selectedGames]);

  const loadCow = useCallback((id: string): boolean => {
    try {
      const raw = localStorage.getItem(COW_PREFIX + id);
      if (!raw) return false;
      const cow: SavedCow = JSON.parse(raw);
      setActive(true);
      setCowId(cow.id);
      setStartLocation(cow.startLocation);
      setEndLocation(cow.endLocation);
      const map = new Map<string, SelectedGame>();
      for (const g of cow.games) {
        map.set(g.est_date, g);
      }
      setSelectedGames(map);
      return true;
    } catch {
      return false;
    }
  }, []);

  const sortedGames = useMemo(
    () => Array.from(selectedGames.values()).sort((a, b) => a.est_date.localeCompare(b.est_date)),
    [selectedGames]
  );

  const value = useMemo<RampageContextValue>(
    () => ({
      active,
      cowId,
      startLocation,
      endLocation,
      selectedGames,
      toggleRampage,
      toggleGame,
      removeGame,
      clearGames,
      setStartLocation,
      setEndLocation,
      saveCow,
      loadCow,
      sortedGames,
    }),
    [active, cowId, startLocation, endLocation, selectedGames, toggleRampage, toggleGame, removeGame, clearGames, saveCow, loadCow, sortedGames]
  );

  return <RampageContext value={value}>{children}</RampageContext>;
}

export function useRampage() {
  const ctx = useContext(RampageContext);
  if (!ctx) throw new Error("useRampage must be used within RampageProvider");
  return ctx;
}
