"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Zap, MapPin, Navigation, Loader2, Search, X, ArrowRight } from "lucide-react";
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
  onPlanLoading,
}: {
  userLocation: { lat: number; lng: number } | null;
  onCancelRampage: () => void;
  onPlanLoading?: (loading: boolean) => void;
}) {
  const rampage = useRampage();
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

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
      // Activate rampage and show the location modal
      rampage.toggleRampage(userLocation);
      setShowModal(true);
    } else {
      // Re-open modal to edit locations
      setShowModal(true);
    }
  }

  function handleStartSelecting() {
    setShowModal(false);
    resetModalState();
  }

  async function handlePlanRampage() {
    const cowId = rampage.saveCow();
    onPlanLoading?.(true);
    try {
      // Load the cow we just saved to build the API request
      const raw = localStorage.getItem(`balltastic_cow_${cowId}`);
      if (!raw) { router.push(`/rampage?cow=${cowId}`); return; }
      const cow = JSON.parse(raw);
      const res = await fetch("/api/rampage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startLocation: cow.startLocation,
          endLocation: cow.endLocation,
          games: cow.games.map((g: any) => ({
            venue: g.venue, lat: g.lat, lng: g.lng, date: g.est_date,
            time: g.est_time ?? "19:00", name: g.name,
            min_price: g.min_price, espn_price: g.espn_price,
          })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        data.games = cow.games;
        try { localStorage.setItem(`balltastic_rampage_result_${cowId}`, JSON.stringify(data)); } catch {}
      }
    } catch { /* navigate anyway */ }
    router.push(`/rampage?cow=${cowId}`);
  }

  function handleCancel() {
    onCancelRampage();
    setShowModal(false);
    resetModalState();
  }

  function resetModalState() {
    setEditingField(null);
    setQuery("");
    setSuggestions([]);
  }

  const gameCount = rampage.selectedGames.size;

  return (
    <>
      {/* Pill buttons — fixed top-left */}
      <div className="fixed top-4 left-4 z-20">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleToggle}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full shadow-md hover:shadow-lg transition-all ${
              rampage.active
                ? "bg-blue-50 border border-blue-200 text-blue-500"
                : "bg-white border border-neutral-200 text-neutral-500 hover:text-blue-500 hover:border-blue-200"
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
                className="flex items-center gap-1 px-3.5 py-2.5 rounded-full bg-white border border-neutral-200 shadow-md text-neutral-500 hover:text-neutral-900 text-xs font-semibold transition-all"
              >
                <X className="size-3.5" />
              </button>
              <button
                onClick={handlePlanRampage}
                className="flex items-center gap-1 px-4 py-2.5 rounded-full bg-blue-400 text-white shadow-md text-xs font-semibold hover:bg-blue-500 transition-all"
              >
                PLAN
                <ArrowRight className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Centered modal overlay */}
      {showModal && rampage.active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCancel();
            }
          }}
        >
          <div
            ref={modalRef}
            className="w-full max-w-md mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          >
            {/* Header */}
            <div className="px-7 pt-7 pb-1">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-[22px] font-bold text-neutral-900 tracking-tight">Plan a Rampage</h2>
                <button
                  onClick={() => handleStartSelecting()}
                  className="size-8 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 hover:shadow-sm text-neutral-600 transition-all"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="text-sm text-neutral-500">Where are you starting and ending?</p>
            </div>

            {/* Location fields */}
            <div className="px-7 py-5 space-y-1">
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
                isFirst
              />

              {/* Connector line */}
              <div className="flex items-center pl-[19px]">
                <div className="w-px h-4 bg-neutral-200" />
              </div>

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
            </div>

            {/* Divider */}
            <div className="border-t border-neutral-100" />

            {/* Actions */}
            <div className="px-7 py-5 flex items-center justify-between">
              <button
                onClick={handleCancel}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold text-neutral-900 underline underline-offset-2 decoration-neutral-300 hover:decoration-neutral-900 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleStartSelecting}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-blue-400 to-blue-500 text-white text-sm font-semibold shadow-lg shadow-blue-400/25 hover:shadow-xl hover:shadow-blue-400/30 hover:brightness-105 active:scale-[0.98] transition-all"
              >
                <MapPin className="size-4" />
                {gameCount > 0 ? "Back to Map" : "Start Selecting Games"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
  isFirst,
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
  isFirst?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        {/* Dot indicator */}
        <div className={`size-[10px] shrink-0 rounded-full border-2 ${
          location
            ? "border-blue-500 bg-blue-500"
            : "border-neutral-300 bg-white"
        }`} />

        {editing ? (
          <div className="flex-1 flex items-center gap-2 border border-neutral-300 rounded-xl px-3.5 py-3 bg-white shadow-sm focus-within:border-neutral-900 focus-within:shadow-md transition-all">
            <Search className="size-4 text-neutral-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search for a city or address..."
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="flex-1 bg-transparent border-none text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none min-w-0"
            />
          </div>
        ) : (
          <button
            onClick={onEdit}
            className={`flex-1 flex items-center gap-2 rounded-xl px-3.5 py-3 text-left transition-all ${
              location
                ? "bg-neutral-50 hover:bg-neutral-100 border border-neutral-200"
                : "border border-dashed border-neutral-300 hover:border-neutral-900 hover:bg-neutral-50"
            }`}
          >
            {location ? (
              <>
                <MapPin className="size-4 text-blue-500 shrink-0" />
                <span className="text-sm font-medium text-neutral-900 truncate">{location.label}</span>
              </>
            ) : (
              <span className="text-sm text-neutral-500">
                {isFirst ? "Where are you starting from?" : "Where do you want to end up?"}
              </span>
            )}
          </button>
        )}

        <button
          onClick={onGps}
          disabled={locating}
          className="shrink-0 p-2 rounded-full text-neutral-400 hover:text-blue-500 hover:bg-blue-50 transition-all"
          title="Use current location"
        >
          {locating ? <Loader2 className="size-4 animate-spin" /> : <Navigation className="size-4" />}
        </button>
      </div>

      {/* Suggestions dropdown */}
      {suggestions.length > 0 && (
        <div className="ml-[22px] mt-1.5 border border-neutral-200 rounded-2xl overflow-hidden bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.placeId}
              onClick={() => onSelectSuggestion(s)}
              className={`w-full text-left px-4 py-3 hover:bg-neutral-50 transition-colors flex items-center gap-3 ${
                i < suggestions.length - 1 ? "border-b border-neutral-100" : ""
              }`}
            >
              <MapPin className="size-4 text-neutral-400 shrink-0" />
              <div>
                <div className="text-sm font-medium text-neutral-900">{s.main}</div>
                <div className="text-xs text-neutral-500">{s.secondary}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
