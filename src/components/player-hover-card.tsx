"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlayerSeasonStats } from "@/app/api/player-stats/route";

// ── Types ────────────────────────────────────────────────────────────────────

interface PlayerInfo {
  name: string;
  position: string;
  jersey: string;
  status: string;
  injuryNote?: string;
  headshot?: string;
  espnId?: string;
}

interface HoverCardAPI {
  show: (player: PlayerInfo, teamName: string, teamAbbr: string, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  hide: () => void;
}

interface HoverState {
  visible: boolean;
  player: PlayerInfo | null;
  teamName: string;
  teamAbbr: string;
  x: number;
  y: number;
  stats: PlayerSeasonStats | null;
  statsLoading: boolean;
  statsError: boolean;
}

const HoverCardContext = createContext<HoverCardAPI | null>(null);

export function usePlayerHoverCard(): HoverCardAPI {
  const ctx = useContext(HoverCardContext);
  if (!ctx) throw new Error("usePlayerHoverCard must be used within PlayerHoverCardProvider");
  return ctx;
}

// ── Client stats cache (30 min) ──────────────────────────────────────────────

const CLIENT_CACHE_TTL = 30 * 60 * 1000;

// ── Provider ─────────────────────────────────────────────────────────────────

export function PlayerHoverCardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HoverState>({
    visible: false,
    player: null,
    teamName: "",
    teamAbbr: "",
    x: 0,
    y: 0,
    stats: null,
    statsLoading: false,
    statsError: false,
  });

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const statsCacheRef = useRef<Map<string, { data: PlayerSeasonStats; ts: number }>>(new Map());
  const fetchControllerRef = useRef<AbortController | null>(null);

  const show = useCallback((player: PlayerInfo, teamName: string, teamAbbr: string, x: number, y: number) => {
    // Clear any pending hide
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    // Abort any in-flight fetch for previous player
    fetchControllerRef.current?.abort();
    fetchControllerRef.current = null;

    setState({
      visible: true,
      player,
      teamName,
      teamAbbr,
      x,
      y,
      stats: null,
      statsLoading: false,
      statsError: false,
    });

    // Fetch stats if espnId available
    if (player.espnId) {
      const cached = statsCacheRef.current.get(player.espnId);
      if (cached && Date.now() - cached.ts < CLIENT_CACHE_TTL) {
        setState((s) => ({ ...s, stats: cached.data, statsLoading: false }));
        return;
      }

      const controller = new AbortController();
      fetchControllerRef.current = controller;

      setState((s) => ({ ...s, statsLoading: true }));

      fetch(`/api/player-stats?id=${player.espnId}`, { signal: controller.signal })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (controller.signal.aborted) return;
          if (d?.stats) {
            statsCacheRef.current.set(player.espnId!, { data: d.stats, ts: Date.now() });
            setState((s) => ({ ...s, stats: d.stats, statsLoading: false }));
          } else {
            setState((s) => ({ ...s, statsLoading: false, statsError: true }));
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setState((s) => ({ ...s, statsLoading: false, statsError: true }));
          }
        });
    }
  }, []);

  const move = useCallback((x: number, y: number) => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      setState((s) => ({ ...s, x, y }));
      rafRef.current = null;
    });
  }, []);

  const hide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      fetchControllerRef.current?.abort();
      fetchControllerRef.current = null;
      setState((s) => ({ ...s, visible: false }));
      hideTimerRef.current = null;
    }, 100);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fetchControllerRef.current?.abort();
    };
  }, []);

  const api = useRef<HoverCardAPI>({ show, move, hide });
  api.current = { show, move, hide };

  // Stable reference to avoid re-renders in consumers
  const stableApi = useRef<HoverCardAPI>({
    show: (...args) => api.current.show(...args),
    move: (...args) => api.current.move(...args),
    hide: () => api.current.hide(),
  }).current;

  return (
    <HoverCardContext.Provider value={stableApi}>
      {children}
      {state.visible && state.player && <HoverCard state={state} />}
    </HoverCardContext.Provider>
  );
}

// ── Hover Card ───────────────────────────────────────────────────────────────

const STAT_CELLS: { key: keyof PlayerSeasonStats; label: string; format?: (v: number) => string }[] = [
  { key: "pointsPerGame", label: "PPG" },
  { key: "reboundsPerGame", label: "RPG" },
  { key: "assistsPerGame", label: "APG" },
  { key: "stealsPerGame", label: "STL" },
  { key: "blocksPerGame", label: "BLK" },
  { key: "fieldGoalPct", label: "FG%", format: (v) => `${v.toFixed(1)}%` },
  { key: "threePointPct", label: "3P%", format: (v) => `${v.toFixed(1)}%` },
  { key: "freeThrowPct", label: "FT%", format: (v) => `${v.toFixed(1)}%` },
  { key: "minutesPerGame", label: "MPG" },
  { key: "gamesPlayed", label: "GP", format: (v) => String(Math.round(v)) },
];

function HoverCard({ state }: { state: HoverState }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [mounted, setMounted] = useState(false);

  // Compute position with viewport clamping
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const offset = 16;

    let left = state.x + offset;
    let top = state.y + offset;

    // Flip horizontally if near right edge
    if (left + rect.width + margin > window.innerWidth) {
      left = state.x - rect.width - offset;
    }
    // Flip vertically if near bottom
    if (top + rect.height + margin > window.innerHeight) {
      top = state.y - rect.height - offset;
    }
    // Clamp to viewport
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));

    setPos({ left, top });
  }, [state.x, state.y]);

  // Fade in after mount
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
    return () => setMounted(false);
  }, []);

  const player = state.player!;
  const parts = player.name.split(" ");
  const first = parts[0] ?? "";
  const last = parts.slice(1).join(" ") || "";

  const statusColorMap: Record<string, string> = {
    Playing: "bg-emerald-100 text-emerald-700",
    Out: "bg-red-100 text-red-600",
    Doubtful: "bg-blue-100 text-blue-600",
    Questionable: "bg-amber-100 text-amber-700",
    "Day-To-Day": "bg-amber-100 text-amber-700",
  };
  const statusColor = statusColorMap[player.status] ?? "bg-neutral-100 text-neutral-600";

  const injuryColor = player.status === "Out" ? "text-red-500" : "text-amber-600";

  return createPortal(
    <div
      ref={cardRef}
      className={`fixed z-[60] pointer-events-none w-[280px] rounded-xl border border-neutral-200 bg-white shadow-xl overflow-hidden transition-opacity duration-150 ${mounted ? "opacity-100" : "opacity-0"}`}
      style={{ left: pos.left, top: pos.top }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-3 pb-2">
        {player.headshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.headshot}
            alt={player.name}
            className="size-12 rounded-full object-cover bg-neutral-100 shrink-0"
          />
        ) : (
          <div className="size-12 rounded-full bg-neutral-200 text-neutral-500 flex items-center justify-center text-sm font-bold shrink-0">
            {(first[0] ?? "") + (last.split(" ").pop()?.[0] ?? "")}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-neutral-900 truncate">{player.name}</div>
          <div className="text-xs text-neutral-500 truncate">
            {player.position && `${player.position} · `}
            {player.jersey && `#${player.jersey} · `}
            {state.teamName}
          </div>
          <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusColor}`}>
            {player.status}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="px-3 pb-2">
        {state.statsLoading && (
          <div className="grid grid-cols-5 gap-x-2 gap-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div className="h-2 w-6 rounded bg-neutral-200 animate-pulse" />
                <div className="h-4 w-8 rounded bg-neutral-100 animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {!state.statsLoading && state.stats && (
          <div className="grid grid-cols-5 gap-x-2 gap-y-2">
            {STAT_CELLS.map((cell) => {
              const raw = state.stats![cell.key];
              const val = typeof raw === "number" && !Number.isNaN(raw) ? raw : 0;
              return (
                <div key={cell.key} className="flex flex-col items-center">
                  <span className="text-[9px] font-medium text-neutral-400 uppercase tracking-wide">{cell.label}</span>
                  <span className="text-sm font-semibold text-neutral-900 tabular-nums leading-tight">
                    {cell.format ? cell.format(val) : val.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {!state.statsLoading && !state.stats && state.statsError && (
          <p className="text-[11px] text-neutral-400 text-center py-1">Season stats unavailable</p>
        )}

        {!state.statsLoading && !state.stats && !state.statsError && !player.espnId && (
          <p className="text-[11px] text-neutral-400 text-center py-1">Season stats unavailable</p>
        )}
      </div>

      {/* Injury note */}
      {player.injuryNote && (
        <div className={`px-3 pb-2.5 text-[11px] ${injuryColor} italic truncate`}>
          {player.injuryNote}
        </div>
      )}
    </div>,
    document.body,
  );
}
