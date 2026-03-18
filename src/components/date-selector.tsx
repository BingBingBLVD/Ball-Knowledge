"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function DateSelector({
  currentDate,
  availableDates,
  onDateChange,
  gameCount,
}: {
  currentDate: string;
  availableDates: string[];
  onDateChange: (date: string) => void;
  gameCount: number;
}) {
  const idx = availableDates.indexOf(currentDate);
  const hasPrev = idx > 0;
  const hasNext = idx < availableDates.length - 1;

  return (
    <div className="glass rounded-xl flex items-center gap-1 px-2 py-1.5 shrink-0">
      <button
        onClick={() => hasPrev && onDateChange(availableDates[idx - 1])}
        disabled={!hasPrev}
        className="p-1 rounded-lg hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="text-center min-w-[120px] px-1">
        <div className="text-sm font-medium leading-tight">{formatDate(currentDate)}</div>
        <div className="text-[10px] text-white/50 leading-tight">
          {gameCount} game{gameCount !== 1 ? "s" : ""}
        </div>
      </div>
      <button
        onClick={() => hasNext && onDateChange(availableDates[idx + 1])}
        disabled={!hasNext}
        className="p-1 rounded-lg hover:bg-white/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
