"use client";

import { Search, X } from "lucide-react";

export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center px-3 py-2.5">
      <Search className="size-4 text-[--color-dim] shrink-0" />
      <input
        type="text"
        placeholder="Search teams, arenas, cities..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent border-none text-sm text-foreground placeholder:text-[--color-dim] focus:outline-none ml-2"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="text-[--color-dim] hover:text-foreground transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
