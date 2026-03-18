"use client";

import { SearchBar } from "./search-bar";
import { DateSelector } from "./date-selector";

export function TopBar({
  search,
  onSearchChange,
  currentDate,
  availableDates,
  onDateChange,
  gameCount,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  currentDate: string;
  availableDates: string[];
  onDateChange: (date: string) => void;
  gameCount: number;
}) {
  return (
    <div className="fixed top-4 left-4 right-4 z-20 flex items-center gap-3 pointer-events-none">
      <div className="pointer-events-auto">
        <SearchBar value={search} onChange={onSearchChange} />
      </div>
      <div className="flex-1" />
      <div className="pointer-events-auto">
        <DateSelector
          currentDate={currentDate}
          availableDates={availableDates}
          onDateChange={onDateChange}
          gameCount={gameCount}
        />
      </div>
    </div>
  );
}
