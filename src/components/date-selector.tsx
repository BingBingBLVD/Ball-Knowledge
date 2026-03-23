"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRampage } from "@/lib/rampage-context";

function formatDateMono(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const mon = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const day = String(d).padStart(2, "0");
  const wday = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return `${mon} ${day} ${wday}`;
}

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function DateSelector({
  currentDate,
  availableDates,
  onDateChange,
  gameCount,
  gameCountByDate,
}: {
  currentDate: string;
  availableDates: string[];
  onDateChange: (date: string) => void;
  gameCount: number;
  gameCountByDate: Record<string, number>;
}) {
  const rampage = useRampage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const idx = availableDates.indexOf(currentDate);
  const hasPrev = idx > 0;
  const hasNext = idx < availableDates.length - 1;
  const prevDate = hasPrev ? availableDates[idx - 1] : null;
  const nextDate = hasNext ? availableDates[idx + 1] : null;

  const [viewYear, setViewYear] = useState(() => {
    const [y] = currentDate.split("-").map(Number);
    return y;
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const [, m] = currentDate.split("-").map(Number);
    return m - 1;
  });

  useEffect(() => {
    const [y, m] = currentDate.split("-").map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
  }, [currentDate]);

  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const rows: (string | null)[][] = [];
    let week: (string | null)[] = [];

    for (let i = 0; i < firstDay; i++) week.push(null);

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      week.push(dateStr);
      if (week.length === 7) {
        rows.push(week);
        week = [];
      }
    }

    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      rows.push(week);
    }

    return rows;
  }, [viewYear, viewMonth]);

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Swipe / drag to change date (small screens where chevrons are hidden)
  const swipeRef = useRef<{ startX: number; startY: number; swiped: boolean } | null>(null);
  const SWIPE_THRESHOLD = 40;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    swipeRef.current = { startX: e.clientX, startY: e.clientY, swiped: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = swipeRef.current;
      if (!s || s.swiped) return;
      const dx = e.clientX - s.startX;
      const dy = Math.abs(e.clientY - s.startY);
      // Only count horizontal swipes
      if (dy > Math.abs(dx)) return;
      if (dx < -SWIPE_THRESHOLD && hasNext) {
        s.swiped = true;
        onDateChange(availableDates[idx + 1]);
      } else if (dx > SWIPE_THRESHOLD && hasPrev) {
        s.swiped = true;
        onDateChange(availableDates[idx - 1]);
      }
    },
    [hasPrev, hasNext, idx, availableDates, onDateChange],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasSwiped = swipeRef.current?.swiped;
      swipeRef.current = null;
      // If it was a tap (no swipe), toggle calendar
      if (!wasSwiped) setOpen((o) => !o);
    },
    [],
  );

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-0.5 px-2 py-1.5 shrink-0">
        {/* Prev arrow — hidden on small screens */}
        <div className="hidden min-[867px]:flex flex-col items-center">
          <button
            onClick={() => {
              if (hasPrev) onDateChange(availableDates[idx - 1]);
            }}
            disabled={!hasPrev}
            className="p-1 rounded hover:bg-neutral-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="size-4 text-[--color-dim]" />
          </button>
          {prevDate && (
            <span className="text-[10px] text-emerald-600 leading-none -mt-0.5">
              {gameCountByDate[prevDate] ?? 0}
            </span>
          )}
        </div>

        {/* Center date — tap to open calendar, swipe to change date */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="text-center min-w-[120px] px-1 rounded hover:bg-neutral-100 transition-colors py-0.5 cursor-pointer select-none touch-pan-y"
        >
          <div className="text-sm font-semibold leading-tight text-neutral-900">
            {formatDateMono(currentDate)}
          </div>
          <div className="text-xs text-neutral-500 leading-tight">
            {gameCount} games
          </div>
        </div>

        {/* Next arrow — hidden on small screens */}
        <div className="hidden min-[867px]:flex flex-col items-center">
          <button
            onClick={() => {
              if (hasNext) onDateChange(availableDates[idx + 1]);
            }}
            disabled={!hasNext}
            className="p-1 rounded hover:bg-neutral-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="size-4 text-[--color-dim]" />
          </button>
          {nextDate && (
            <span className="text-[10px] text-emerald-600 leading-none -mt-0.5">
              {gameCountByDate[nextDate] ?? 0}
            </span>
          )}
        </div>
      </div>

      {/* Calendar dropdown — centered overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-neutral-200 p-4 shadow-xl min-w-[300px] animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} className="p-1.5 rounded-md hover:bg-neutral-100 transition-all">
                <ChevronLeft className="size-4 text-[--color-dim]" />
              </button>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground tracking-wide">{monthLabel}</span>
                {(() => {
                  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
                  const todayAvailable = availableSet.has(today);
                  const isAlreadyToday = currentDate === today;
                  return (
                    <button
                      onClick={() => {
                        if (todayAvailable) {
                          onDateChange(today);
                          setOpen(false);
                        }
                      }}
                      disabled={!todayAvailable || isAlreadyToday}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide transition-all ${
                        isAlreadyToday
                          ? "bg-[--primary]/20 text-[--primary] cursor-default"
                          : todayAvailable
                            ? "bg-[--primary] text-[--primary-foreground] hover:brightness-110 cursor-pointer"
                            : "bg-neutral-100 text-[--color-dim]/50 cursor-not-allowed"
                      }`}
                    >
                      TDY
                    </button>
                  );
                })()}
              </div>
              <button onClick={nextMonth} className="p-1.5 rounded-md hover:bg-neutral-100 transition-all">
                <ChevronRight className="size-4 text-[--color-dim]" />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_NAMES.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-[--color-dim] py-1">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-0.5">
              {calendarDays.flat().map((dateStr, i) => {
                if (!dateStr) {
                  return <div key={`blank-${i}`} className="h-10" />;
                }
                const dayNum = parseInt(dateStr.split("-")[2]);
                const hasGames = availableSet.has(dateStr);
                const count = gameCountByDate[dateStr] ?? 0;
                const isSelected = dateStr === currentDate;
                const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
                const isToday = dateStr === today;
                const hasRampageGame = rampage.active && rampage.selectedGames.has(dateStr);

                return (
                  <button
                    key={dateStr}
                    onClick={() => {
                      if (hasGames) {
                        onDateChange(dateStr);
                        setOpen(false);
                      }
                    }}
                    disabled={!hasGames}
                    className={`relative h-10 flex flex-col items-center justify-center rounded-md text-xs transition-all ${
                      isSelected
                        ? "bg-[--primary] text-[--primary-foreground] font-bold shadow-md shadow-[--primary]/25"
                        : hasGames
                          ? "text-foreground font-medium hover:bg-neutral-100 cursor-pointer"
                          : "text-[--color-dim]/40 cursor-default"
                    } ${isToday && !isSelected ? "ring-1 ring-[--primary]/50" : ""} ${hasRampageGame && !isSelected ? "ring-1 ring-[--color-rampage]" : ""}`}
                  >
                    <span className="leading-none">{dayNum}</span>
                    {hasRampageGame ? (
                      <span className={`text-[8px] leading-none mt-0.5 ${isSelected ? "text-[--primary-foreground]/70" : "text-[--color-rampage]"}`}>
                        ●
                      </span>
                    ) : hasGames && count > 0 ? (
                      <span className={`text-[8px] leading-none mt-0.5 ${isSelected ? "text-[--primary-foreground]/70" : "text-emerald-600"}`}>
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
