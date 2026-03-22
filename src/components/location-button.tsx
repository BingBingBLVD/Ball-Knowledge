"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Navigation, Search, X, Loader2 } from "lucide-react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

let placesReady: Promise<void> | null = null;
function ensurePlaces(): Promise<void> {
  if (!placesReady) {
    setOptions({ key: API_KEY, v: "weekly" });
    placesReady = importLibrary("places").then(() => {});
  }
  return placesReady;
}

interface Suggestion {
  placeId: string;
  main: string;
  secondary: string;
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
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Init Google Places
  useEffect(() => {
    ensurePlaces().then(() => {
      autocompleteRef.current = new google.maps.places.AutocompleteService();
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      geocoderRef.current = new google.maps.Geocoder();
    });
  }, []);

  // Reverse geocode current location for label
  useEffect(() => {
    if (!userLocation || !geocoderRef.current) {
      setLabel(null);
      return;
    }
    geocoderRef.current.geocode(
      { location: { lat: userLocation.lat, lng: userLocation.lng } },
      (results, status) => {
        if (status === "OK" && results?.[0]) {
          const addr = results[0].address_components;
          const city = addr.find((c) => c.types.includes("locality"))?.short_name;
          const state = addr.find((c) => c.types.includes("administrative_area_level_1"))?.short_name;
          setLabel(city && state ? `${city}, ${state}` : results[0].formatted_address.split(",").slice(0, 2).join(","));
        }
      }
    );
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

  const fetchSuggestions = useCallback((input: string) => {
    if (!input.trim() || !autocompleteRef.current) {
      setSuggestions([]);
      return;
    }
    autocompleteRef.current.getPlacePredictions(
      {
        input,
        types: ["geocode"],
        sessionToken: sessionTokenRef.current!,
      },
      (predictions, status) => {
        if (status !== "OK" || !predictions) {
          setSuggestions([]);
          return;
        }
        setSuggestions(
          predictions.slice(0, 4).map((p) => ({
            placeId: p.place_id,
            main: p.structured_formatting.main_text,
            secondary: p.structured_formatting.secondary_text,
          }))
        );
      }
    );
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
    if (!geocoderRef.current) return;
    geocoderRef.current.geocode({ placeId: s.placeId }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        onLocationChange({ lat: loc.lat(), lng: loc.lng() });
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        setSuggestions([]);
        setQuery("");
        setAddressMode(false);
        setOpen(false);
      }
    });
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
    <div ref={containerRef} className="fixed top-4 right-4 z-20">
      {/* Toggle button */}
      <button
        onClick={() => { setOpen(!open); setAddressMode(false); setQuery(""); setSuggestions([]); }}
        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl shadow-lg transition-all ${
          userLocation
            ? "border border-[--primary]/30 text-[--primary] shadow-[--primary]/10"
            : "border border-white/10 text-[--color-dim]"
        }`}
        style={{ background: "rgba(10,10,15,0.65)", backdropFilter: "blur(20px) saturate(1.5)", WebkitBackdropFilter: "blur(20px) saturate(1.5)" }}
      >
        <MapPin className="size-4" />
        {userLocation && label ? (
          <span className="text-[11px] font-mono max-w-[120px] truncate">{label}</span>
        ) : null}
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute top-full right-0 mt-2 w-72 panel-elevated rounded-xl shadow-2xl overflow-hidden">
          {/* Use current location */}
          <button
            onClick={useCurrentLocation}
            disabled={locating}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.06] transition-all border-b border-white/8"
          >
            {locating ? (
              <Loader2 className="size-4 text-[--primary] animate-spin" />
            ) : (
              <Navigation className="size-4 text-[--primary]" />
            )}
            <div>
              <div className="text-sm font-medium text-foreground">Use current location</div>
              <div className="text-[11px] text-[--color-dim] font-mono">GPS / browser location</div>
            </div>
          </button>

          {/* Search address */}
          {!addressMode ? (
            <button
              onClick={() => setAddressMode(true)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.06] transition-all"
            >
              <Search className="size-4 text-[--color-dim]" />
              <div>
                <div className="text-sm font-medium text-foreground">Enter an address</div>
                <div className="text-[11px] text-[--color-dim] font-mono">Search by street address</div>
              </div>
            </button>
          ) : (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 border border-white/10 rounded px-2 py-1.5">
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
                      key={s.placeId}
                      onClick={() => selectSuggestion(s)}
                      className="w-full text-left px-2 py-2 text-sm hover:bg-white/5 rounded transition-colors"
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
