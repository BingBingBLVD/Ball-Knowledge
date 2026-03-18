"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Navigation, X } from "lucide-react";

export function LocationPicker({
  userLocation,
  onLocationChange,
}: {
  userLocation: { lat: number; lng: number } | null;
  onLocationChange: (loc: { lat: number; lng: number } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reverse geocode user location to get a city name
  useEffect(() => {
    if (!userLocation) {
      setLabel(null);
      return;
    }
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return;
    fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${userLocation.lat},${userLocation.lng}&result_type=locality&key=${key}`
    )
      .then((r) => r.json())
      .then((data) => {
        const result = data.results?.[0];
        if (result) {
          // Extract city + state
          const city = result.address_components?.find((c: { types: string[] }) =>
            c.types.includes("locality")
          );
          const state = result.address_components?.find((c: { types: string[] }) =>
            c.types.includes("administrative_area_level_1")
          );
          if (city) {
            setLabel(
              state ? `${city.short_name}, ${state.short_name}` : city.short_name
            );
          } else {
            setLabel(result.formatted_address?.split(",")[0] ?? "Unknown");
          }
        }
      })
      .catch(() => {});
  }, [userLocation]);

  // Close on outside click
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

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  function handleGeocode() {
    if (!query.trim()) return;
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return;
    setLoading(true);
    fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`
    )
      .then((r) => r.json())
      .then((data) => {
        const loc = data.results?.[0]?.geometry?.location;
        if (loc) {
          onLocationChange({ lat: loc.lat, lng: loc.lng });
          setOpen(false);
          setQuery("");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocationChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setOpen(false);
        setQuery("");
      },
      () => {},
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="glass rounded-xl flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/5 transition-colors"
      >
        <MapPin className="size-4 text-blue-400 shrink-0" />
        <span className="truncate max-w-[120px] text-white/80">
          {label ?? (userLocation ? "My Location" : "Set Location")}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 glass rounded-xl p-3 min-w-[260px] z-50">
          <div className="flex items-center gap-2 mb-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Enter city or address..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGeocode();
              }}
              className="flex-1 bg-white/5 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-white/40 hover:text-white/70"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleGeocode}
              disabled={!query.trim() || loading}
              className="flex-1 bg-blue-500/20 text-blue-400 text-xs font-medium rounded-lg px-3 py-1.5 hover:bg-blue-500/30 disabled:opacity-40 transition-colors"
            >
              {loading ? "..." : "Go"}
            </button>
            <button
              onClick={handleUseMyLocation}
              className="flex items-center gap-1.5 bg-white/5 text-white/60 text-xs rounded-lg px-3 py-1.5 hover:bg-white/10 hover:text-white/80 transition-colors"
            >
              <Navigation className="size-3" />
              Use GPS
            </button>
          </div>
          {userLocation && label && (
            <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-white/40">
              Current: {label} ({userLocation.lat.toFixed(2)}, {userLocation.lng.toFixed(2)})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
