"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Navigation, Search, X, Loader2 } from "lucide-react";

interface Suggestion {
  id: string;
  main: string;
  secondary: string;
  lat: number;
  lng: number;
}

export function LocationButton({
  userLocation,
  onLocationChange,
}: {
  userLocation: { lat: number; lng: number } | null;
  onLocationChange: (loc: { lat: number; lng: number } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addressMode, setAddressMode] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [locating, setLocating] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reverse geocode current location for label via Nominatim
  useEffect(() => {
    if (!userLocation) {
      setLabel(null);
      return;
    }
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${userLocation.lat}&lon=${userLocation.lng}&format=json&addressdetails=1`,
      { headers: { "Accept-Language": "en" } }
    )
      .then((res) => res.json())
      .then((data) => {
        const addr = data.address;
        const city = addr?.city || addr?.town || addr?.village || "";
        const state = addr?.state || "";
        setLabel(city && state ? `${city}, ${state}` : data.display_name?.split(",").slice(0, 2).join(",") ?? null);
      })
      .catch(() => setLabel(null));
  }, [userLocation]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAddressMode(false);
        setQuery("");
        setSuggestions([]);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus input when address mode opens
  useEffect(() => {
    if (addressMode && inputRef.current) inputRef.current.focus();
  }, [addressMode]);

  const fetchSuggestions = useCallback(async (input: string) => {
    if (!input.trim()) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&limit=4&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      if (!res.ok) { setSuggestions([]); return; }
      const data = await res.json();
      setSuggestions(
        data.map((r: { place_id: number; display_name: string; lat: string; lon: string }) => {
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
    } catch {
      setSuggestions([]);
    }
  }, []);

  function handleQueryChange(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length >= 2) {
      debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
    } else {
      setSuggestions([]);
    }
  }

  function selectSuggestion(s: Suggestion) {
    onLocationChange({ lat: s.lat, lng: s.lng });
    setSuggestions([]);
    setQuery("");
    setAddressMode(false);
    setOpen(false);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocationChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        setOpen(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div ref={containerRef} className="fixed top-4 right-4 min-[867px]:right-[calc(50%+1rem)] z-20">
      {/* Toggle button */}
      <button
        onClick={() => { setOpen(!open); setAddressMode(false); setQuery(""); setSuggestions([]); }}
        className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white border shadow-md hover:shadow-lg transition-all ${
          userLocation
            ? "border-neutral-200 text-neutral-900"
            : "border-neutral-200 text-neutral-500"
        }`}
      >
        <MapPin className="size-4" />
        {userLocation && label ? (
          <span className="text-xs font-medium max-w-[120px] truncate">{label}</span>
        ) : null}
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl border border-neutral-200 shadow-xl overflow-hidden">
          {/* Use current location */}
          <button
            onClick={useCurrentLocation}
            disabled={locating}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition-all border-b border-neutral-100"
          >
            {locating ? (
              <Loader2 className="size-4 text-[--primary] animate-spin" />
            ) : (
              <Navigation className="size-4 text-[--primary]" />
            )}
            <div>
              <div className="text-sm font-medium text-foreground">Use current location</div>
              <div className="text-xs text-neutral-500">GPS / browser location</div>
            </div>
          </button>

          {/* Search address */}
          {!addressMode ? (
            <button
              onClick={() => setAddressMode(true)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50 transition-all"
            >
              <Search className="size-4 text-neutral-400" />
              <div>
                <div className="text-sm font-medium text-neutral-900">Enter an address</div>
                <div className="text-xs text-neutral-500">Search by street address</div>
              </div>
            </button>
          ) : (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 border border-neutral-200 rounded-lg px-2 py-1.5">
                <Search className="size-3.5 text-[--color-dim] shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Type an address..."
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  className="flex-1 bg-transparent border-none text-sm text-foreground placeholder:text-[--color-dim] focus:outline-none"
                />
                {query && (
                  <button onClick={() => { setQuery(""); setSuggestions([]); }} className="text-[--color-dim] hover:text-foreground">
                    <X className="size-3" />
                  </button>
                )}
              </div>
              {suggestions.length > 0 && (
                <div className="mt-1">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => selectSuggestion(s)}
                      className="w-full text-left px-2 py-2 text-sm hover:bg-neutral-50 rounded transition-colors"
                    >
                      <div className="font-medium text-xs text-foreground">{s.main}</div>
                      <div className="text-[11px] text-[--color-dim]">{s.secondary}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
