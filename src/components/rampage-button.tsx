"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Zap, MapPin, Navigation, Loader2, Search, X, ArrowRight, Trash2 } from "lucide-react";
import { useRampage } from "@/lib/rampage-context";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { useRouter } from "next/navigation";

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

export function RampageButton({
  userLocation,
  onCancelRampage,
}: {
  userLocation: { lat: number; lng: number } | null;
  onCancelRampage: () => void;
}) {
  const rampage = useRampage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Address search state for start/end
  const [editingField, setEditingField] = useState<"start" | "end" | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [locatingField, setLocatingField] = useState<"start" | "end" | null>(null);

  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ensurePlaces().then(() => {
      autocompleteRef.current = new google.maps.places.AutocompleteService();
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      geocoderRef.current = new google.maps.Geocoder();
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingField(null);
        setQuery("");
        setSuggestions([]);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (editingField && inputRef.current) inputRef.current.focus();
  }, [editingField]);

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
    if (!geocoderRef.current || !editingField) return;
    geocoderRef.current.geocode({ placeId: s.placeId }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        const locObj = { lat: loc.lat(), lng: loc.lng(), label: s.main };
        if (editingField === "start") rampage.setStartLocation(locObj);
        else rampage.setEndLocation(locObj);
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        setSuggestions([]);
        setQuery("");
        setEditingField(null);
      }
    });
  }

  function useGps(field: "start" | "end") {
    if (!navigator.geolocation) return;
    setLocatingField(field);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const locObj = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Current Location" };
        if (field === "start") rampage.setStartLocation(locObj);
        else rampage.setEndLocation(locObj);
        setLocatingField(null);
      },
      () => setLocatingField(null),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  function handleToggle() {
    if (!rampage.active) {
      rampage.toggleRampage(userLocation);
      setOpen(true);
    } else {
      setOpen(!open);
    }
  }

  function handlePlanRampage() {
    const cowId = rampage.saveCow();
    router.push(`/rampage?cow=${cowId}`);
  }

  function handleCancel() {
    onCancelRampage();
    setOpen(false);
  }

  const gameCount = rampage.selectedGames.size;
  const sortedGames = rampage.sortedGames;

  return (
    <div ref={containerRef} className="fixed top-4 left-4 z-20">
      {/* Toggle button + PLAN shortcut */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleToggle}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full shadow-md hover:shadow-lg transition-all ${
            rampage.active
              ? "bg-violet-50 border border-violet-300 text-violet-600"
              : "bg-white border border-neutral-200 text-neutral-500 hover:text-violet-600 hover:border-violet-300"
          }`}
        >
          <Zap className="size-4" />
          {rampage.active && (
            <span className="text-[11px] font-semibold tracking-wider">
              {gameCount > 0 ? `${gameCount} GAME${gameCount !== 1 ? "S" : ""}` : "RAMPAGE"}
            </span>
          )}
        </button>
        {rampage.active && gameCount >= 1 && (
          <>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-2.5 py-2 rounded-full bg-white border border-neutral-200 shadow-md text-neutral-500 hover:text-neutral-900 text-xs font-semibold transition-all"
            >
              <X className="size-3.5" />
            </button>
            <button
              onClick={handlePlanRampage}
              className="flex items-center gap-1 px-3 py-2 rounded-full bg-violet-500 text-white shadow-md text-xs font-semibold hover:bg-violet-600 transition-all"
            >
              PLAN
              <ArrowRight className="size-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Dropdown */}
      {open && rampage.active && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl border border-neutral-200 shadow-xl overflow-hidden">
          {/* Start location */}
          <LocationRow
            label="START"
            location={rampage.startLocation}
            editing={editingField === "start"}
            locating={locatingField === "start"}
            onEdit={() => { setEditingField("start"); setQuery(""); setSuggestions([]); }}
            onGps={() => useGps("start")}
            query={editingField === "start" ? query : ""}
            onQueryChange={handleQueryChange}
            suggestions={editingField === "start" ? suggestions : []}
            onSelectSuggestion={selectSuggestion}
            inputRef={editingField === "start" ? inputRef : undefined}
          />

          {/* Arrow separator */}
          <div className="flex items-center justify-center py-1 border-b border-neutral-100">
            <ArrowRight className="size-3 text-[--color-dim] rotate-90" />
          </div>

          {/* End location */}
          <LocationRow
            label="END"
            location={rampage.endLocation}
            editing={editingField === "end"}
            locating={locatingField === "end"}
            onEdit={() => { setEditingField("end"); setQuery(""); setSuggestions([]); }}
            onGps={() => useGps("end")}
            query={editingField === "end" ? query : ""}
            onQueryChange={handleQueryChange}
            suggestions={editingField === "end" ? suggestions : []}
            onSelectSuggestion={selectSuggestion}
            inputRef={editingField === "end" ? inputRef : undefined}
          />

          {/* Selected games list */}
          {sortedGames.length > 0 && (
            <div className="border-t border-neutral-100">
              <div className="px-3 py-1.5 text-[10px] tracking-widest text-[--color-dim] uppercase">
                Selected Games
              </div>
              {sortedGames.map((g, i) => (
                <div key={g.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-neutral-50">
                  <span className="size-5 shrink-0 rounded-full bg-[--color-rampage] text-white flex items-center justify-center text-[10px] font-bold">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground truncate">{g.name.split(/\s+(?:vs?\.?|VS\.?)\s+/).join(" @ ")}</div>
                    <div className="text-[10px] text-[--color-dim]">
                      {new Date(g.est_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" })}
                      {" · "}{g.venue}
                    </div>
                  </div>
                  <button
                    onClick={() => rampage.removeGame(g.est_date)}
                    className="text-[--color-dim] hover:text-[--color-danger] transition-colors shrink-0"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-white/8 p-2 flex gap-2">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-[--color-dim] hover:text-foreground hover:bg-white/[0.06] transition-all"
            >
              <X className="size-3" /> CANCEL
            </button>
            <button
              onClick={handlePlanRampage}
              disabled={gameCount < 1}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                gameCount >= 1
                  ? "bg-[--color-rampage] text-white shadow-md shadow-[--color-rampage]/20 hover:brightness-110"
                  : "bg-white/[0.04] text-[--color-dim] cursor-not-allowed"
              }`}
            >
              <Zap className="size-3.5" />
              {gameCount >= 1 ? "PLAN RAMPAGE" : "SELECT A GAME"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LocationRow({
  label,
  location,
  editing,
  locating,
  onEdit,
  onGps,
  query,
  onQueryChange,
  suggestions,
  onSelectSuggestion,
  inputRef,
}: {
  label: string;
  location: { lat: number; lng: number; label: string } | null;
  editing: boolean;
  locating: boolean;
  onEdit: () => void;
  onGps: () => void;
  query: string;
  onQueryChange: (val: string) => void;
  suggestions: Suggestion[];
  onSelectSuggestion: (s: Suggestion) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="border-b border-neutral-100">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[10px] tracking-widest text-[--color-dim] w-8 shrink-0">{label}</span>
        {editing ? (
          <div className="flex-1 flex items-center gap-1.5 border border-white/10 rounded px-2 py-1">
            <Search className="size-3 text-[--color-dim] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Type an address..."
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="flex-1 bg-transparent border-none text-xs text-foreground placeholder:text-[--color-dim] focus:outline-none min-w-0"
            />
          </div>
        ) : (
          <button
            onClick={onEdit}
            className="flex-1 text-left text-xs text-foreground hover:text-[--color-rampage] transition-colors truncate"
          >
            {location ? (
              <span className="flex items-center gap-1">
                <MapPin className="size-3 text-[--color-rampage] shrink-0" />
                {location.label}
              </span>
            ) : (
              <span className="text-[--color-dim]">Set location...</span>
            )}
          </button>
        )}
        <button
          onClick={onGps}
          disabled={locating}
          className="shrink-0 text-[--color-dim] hover:text-[--color-rampage] transition-colors"
          title="Use current location"
        >
          {locating ? <Loader2 className="size-3.5 animate-spin" /> : <Navigation className="size-3.5" />}
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="px-3 pb-2">
          {suggestions.map((s) => (
            <button
              key={s.placeId}
              onClick={() => onSelectSuggestion(s)}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-neutral-50 rounded transition-colors"
            >
              <div className="font-medium text-foreground">{s.main}</div>
              <div className="text-[10px] text-[--color-dim]">{s.secondary}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
