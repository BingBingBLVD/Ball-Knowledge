"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  lat: number;
  lng: number;
}

export function SearchBar({
  value,
  onChange,
  onLocationChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onLocationChange?: (loc: { lat: number; lng: number }) => void;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (suggestions.length === 0) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [suggestions.length]);

  const fetchSuggestions = useCallback(async (input: string) => {
    if (!input.trim()) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&limit=3&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      if (!res.ok) { setSuggestions([]); return; }
      const data = await res.json();
      setSuggestions(
        data.map((r: { place_id: number; display_name: string; lat: string; lon: string; address?: { city?: string; state?: string; country?: string } }) => {
          const parts = r.display_name.split(", ");
          return {
            id: String(r.place_id),
            main: parts[0],
            secondary: parts.slice(1, 3).join(", "),
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
          };
        })
      );
      setSelectedIdx(-1);
    } catch {
      setSuggestions([]);
    }
  }, []);

  function handleChange(val: string) {
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (onLocationChange && val.length >= 2) {
      debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
    } else {
      setSuggestions([]);
    }
  }

  function selectSuggestion(s: Suggestion) {
    if (!onLocationChange) return;
    onLocationChange({ lat: s.lat, lng: s.lng });
    setSuggestions([]);
    onChange("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIdx >= 0 && suggestions[selectedIdx]) {
      e.preventDefault();
      selectSuggestion(suggestions[selectedIdx]);
    } else if (e.key === "Escape") {
      setSuggestions([]);
    }
  }

  function handleClear() {
    onChange("");
    setSuggestions([]);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center px-4 py-3 bg-neutral-50 rounded-xl">
        <Search className="size-4 text-[--color-dim] shrink-0" />
        <input
          type="text"
          placeholder="Search teams, cities..."
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none text-sm text-foreground placeholder:text-[--color-dim] focus:outline-none ml-2"
        />
        {value && (
          <button
            onClick={handleClear}
            className="text-[--color-dim] hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-neutral-200 py-1 z-50 shadow-xl">
          <div className="px-3 py-1 text-[10px] font-semibold text-neutral-500 tracking-widest uppercase">
            Set Location
          </div>
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              onClick={() => selectSuggestion(s)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                i === selectedIdx
                  ? "bg-neutral-100 text-neutral-900"
                  : "text-neutral-900 hover:bg-neutral-50"
              }`}
            >
              <div className="font-medium text-xs">{s.main}</div>
              <div className="text-[11px] text-neutral-500">{s.secondary}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
