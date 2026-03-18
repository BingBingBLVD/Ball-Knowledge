"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plane,
  Bus,
  Car,
  TrainFront,
  Clock,
  MapPin,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Navigation,
  Loader2,
  Zap,
  ArrowLeftRight,
} from "lucide-react";
import Link from "next/link";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

// ── Types ──────────────────────────────────────────────────────────────────

interface Leg {
  mode: "flight" | "drive" | "rideshare" | "transit" | "bus" | "train";
  carrier?: string;
  routeName?: string;
  from: string;
  fromLat: number;
  fromLng: number;
  to: string;
  toLat: number;
  toLng: number;
  depart: string;
  arrive: string;
  minutes: number;
  cost: number | null;
  bookingUrl?: string;
  miles: number;
  enrichable?: boolean;
}

interface Itinerary {
  id: string;
  totalMinutes: number;
  totalCost: number | null;
  departureTime: string;
  arrivalTime: string;
  bufferMinutes: number;
  legs: Leg[];
  enriched?: boolean;
}

interface EnrichResult {
  driveMinutes: number;
  transitMinutes: number | null;
  transitFare: string | null;
  uberEstimate: string | null;
  lyftEstimate: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function modeIcon(mode: string) {
  switch (mode) {
    case "flight":
      return <Plane className="size-4" />;
    case "drive":
    case "rideshare":
      return <Car className="size-4" />;
    case "bus":
      return <Bus className="size-4" />;
    case "train":
      return <TrainFront className="size-4" />;
    case "transit":
      return <Bus className="size-4" />;
    default:
      return <Navigation className="size-4" />;
  }
}

function modeColor(mode: string): string {
  switch (mode) {
    case "flight":
      return "text-violet-600";
    case "drive":
    case "rideshare":
      return "text-gray-600";
    case "bus":
      return "text-green-600";
    case "train":
      return "text-blue-600";
    case "transit":
      return "text-teal-600";
    default:
      return "text-gray-500";
  }
}

function modeBgColor(mode: string): string {
  switch (mode) {
    case "flight":
      return "bg-violet-50 text-violet-700";
    case "drive":
    case "rideshare":
      return "bg-gray-100 text-gray-700";
    case "bus":
      return "bg-green-50 text-green-700";
    case "train":
      return "bg-blue-50 text-blue-700";
    case "transit":
      return "bg-teal-50 text-teal-700";
    default:
      return "bg-gray-50 text-gray-600";
  }
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "flight":
      return "Flight";
    case "drive":
      return "Drive";
    case "rideshare":
      return "Drive";
    case "bus":
      return "Bus";
    case "train":
      return "Train";
    case "transit":
      return "Transit";
    default:
      return mode;
  }
}

function modeMapColor(mode: string): string {
  switch (mode) {
    case "flight":
      return "#7C3AED";
    case "drive":
    case "rideshare":
      return "#6B7280";
    case "bus":
      return "#16A34A";
    case "train":
      return "#2563EB";
    case "transit":
      return "#0D9488";
    default:
      return "#6B7280";
  }
}

function uberUrl(
  fromName: string,
  fromLat: number,
  fromLng: number,
  toName: string,
  toLat: number,
  toLng: number
): string {
  const pickup = encodeURIComponent(
    JSON.stringify({
      addressLine1: fromName,
      latitude: fromLat,
      longitude: fromLng,
      source: "SEARCH",
      provider: "uber_places",
    })
  );
  const drop = encodeURIComponent(
    JSON.stringify({
      addressLine1: toName,
      latitude: toLat,
      longitude: toLng,
      source: "SEARCH",
      provider: "uber_places",
    })
  );
  return `https://m.uber.com/go/product-selection?pickup=${pickup}&drop%5B0%5D=${drop}`;
}

function lyftUrl(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): string {
  return `https://lyft.com/ride?start[latitude]=${fromLat}&start[longitude]=${fromLng}&destination[latitude]=${toLat}&destination[longitude]=${toLng}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TakeMePageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-gray-400" />
        </div>
      }
    >
      <TakeMePage />
    </Suspense>
  );
}

function TakeMePage() {
  const searchParams = useSearchParams();

  const initOriginLat = searchParams.get("originLat") ?? "";
  const initOriginLng = searchParams.get("originLng") ?? "";
  const venue = searchParams.get("venue") ?? "";
  const venueLat = searchParams.get("venueLat") ?? "";
  const venueLng = searchParams.get("venueLng") ?? "";
  const date = searchParams.get("date") ?? "";
  const time = searchParams.get("time") ?? "";
  const game = searchParams.get("game") ?? "";

  // Editable origin location
  const [originLat, setOriginLat] = useState(initOriginLat);
  const [originLng, setOriginLng] = useState(initOriginLng);
  const [originInput, setOriginInput] = useState("");
  const [originLoading, setOriginLoading] = useState(false);
  const [originSuggestions, setOriginSuggestions] = useState<
    { placeId: string; main: string; secondary: string }[]
  >([]);
  const [sugIdx, setSugIdx] = useState(-1);
  const originDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // Map state
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<(google.maps.Polyline | google.maps.Marker)[]>([]);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  // Init Google services + reverse-geocode initial coordinates
  useEffect(() => {
    const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
    if (!API_KEY) return;
    setOptions({ key: API_KEY, v: "weekly" });
    Promise.all([importLibrary("places"), importLibrary("maps")]).then(() => {
      autocompleteRef.current = new google.maps.places.AutocompleteService();
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      geocoderRef.current = new google.maps.Geocoder();
      directionsServiceRef.current = new google.maps.DirectionsService();
      // Init map
      if (mapContainerRef.current && !mapRef.current) {
        mapRef.current = new google.maps.Map(mapContainerRef.current, {
          center: {
            lat: parseFloat(venueLat) || 39.5,
            lng: parseFloat(venueLng) || -98.35,
          },
          zoom: 5,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
        });
      }
      // Reverse-geocode initial location
      if (initOriginLat && initOriginLng) {
        geocoderRef.current.geocode(
          { location: { lat: parseFloat(initOriginLat), lng: parseFloat(initOriginLng) } },
          (results, status) => {
            if (status === "OK" && results?.[0]) {
              const city = results[0].address_components?.find((c) =>
                c.types.includes("locality")
              );
              const state = results[0].address_components?.find((c) =>
                c.types.includes("administrative_area_level_1")
              );
              if (city) {
                setOriginInput(
                  state ? `${city.long_name}, ${state.short_name}` : city.long_name
                );
              } else {
                setOriginInput(results[0].formatted_address?.split(",").slice(0, 2).join(",") ?? "");
              }
            }
          }
        );
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchOriginSuggestions = useCallback((input: string) => {
    if (!input.trim() || !autocompleteRef.current) {
      setOriginSuggestions([]);
      return;
    }
    autocompleteRef.current.getPlacePredictions(
      { input, types: ["geocode"], sessionToken: sessionTokenRef.current! },
      (predictions, status) => {
        if (status !== "OK" || !predictions) {
          setOriginSuggestions([]);
          return;
        }
        setOriginSuggestions(
          predictions.slice(0, 5).map((p) => ({
            placeId: p.place_id,
            main: p.structured_formatting.main_text,
            secondary: p.structured_formatting.secondary_text,
          }))
        );
        setSugIdx(-1);
      }
    );
  }, []);

  const selectOriginSuggestion = useCallback(
    (s: { placeId: string; main: string; secondary: string }) => {
      if (!geocoderRef.current) return;
      geocoderRef.current.geocode({ placeId: s.placeId }, (results, status) => {
        if (status === "OK" && results?.[0]?.geometry?.location) {
          const loc = results[0].geometry.location;
          setOriginLat(String(loc.lat()));
          setOriginLng(String(loc.lng()));
          setOriginInput(`${s.main}, ${s.secondary}`);
          setOriginSuggestions([]);
          sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        }
      });
    },
    []
  );

  const geocodeOriginInput = useCallback(() => {
    if (!originInput.trim() || !geocoderRef.current) return;
    setOriginLoading(true);
    geocoderRef.current.geocode({ address: originInput }, (results, status) => {
      if (status === "OK" && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        setOriginLat(String(loc.lat()));
        setOriginLng(String(loc.lng()));
        setOriginInput(results[0].formatted_address ?? originInput);
        setOriginSuggestions([]);
      }
      setOriginLoading(false);
    });
  }, [originInput]);

  const [resultLimit, setResultLimit] = useState(10);
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transitPref, setTransitPref] = useState<"all" | "bus" | "train">(
    "all"
  );

  // Enrichment state: itinerary id → leg index → enrichment data
  const [enrichments, setEnrichments] = useState<
    Record<string, Record<number, EnrichResult>>
  >({});
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  // Track which legs have been swapped to transit
  const [swappedToTransit, setSwappedToTransit] = useState<Set<string>>(
    new Set()
  );

  const fetchItineraries = useCallback(async () => {
    if (!originLat || !originLng || !venue || !date || !time) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        originLat,
        originLng,
        venue,
        venueLat,
        venueLng,
        date,
        time,
        limit: String(resultLimit),
        transitPref,
      });
      const res = await fetch(`/api/take-me?${params}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setItineraries(data.itineraries ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load itineraries"
      );
    } finally {
      setLoading(false);
    }
  }, [originLat, originLng, venue, venueLat, venueLng, date, time, resultLimit, transitPref]);

  useEffect(() => {
    fetchItineraries();
  }, [fetchItineraries]);

  // Enrich all drive/rideshare legs of an itinerary
  const enrichItinerary = useCallback(
    async (it: Itinerary) => {
      const enrichKey = it.id;
      if (enriching.has(enrichKey)) return;

      const enrichableLegs = it.legs
        .map((l, i) => ({ leg: l, idx: i }))
        .filter(({ leg }) => leg.enrichable);

      if (enrichableLegs.length === 0) return;

      setEnriching((prev) => new Set(prev).add(enrichKey));
      try {
        const res = await fetch("/api/enrich-itinerary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legs: enrichableLegs.map(({ leg }) => ({
              fromLat: leg.fromLat,
              fromLng: leg.fromLng,
              toLat: leg.toLat,
              toLng: leg.toLng,
            })),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const legEnrichments: Record<number, EnrichResult> = {};
          enrichableLegs.forEach(({ idx }, i) => {
            if (data.legs[i]) {
              legEnrichments[idx] = data.legs[i];
            }
          });
          setEnrichments((prev) => ({
            ...prev,
            [enrichKey]: legEnrichments,
          }));
        }
      } finally {
        setEnriching((prev) => {
          const next = new Set(prev);
          next.delete(enrichKey);
          return next;
        });
      }
    },
    [enriching]
  );

  const toggleTransitSwap = useCallback((key: string) => {
    setSwappedToTransit((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Draw itinerary legs on map when expanded itinerary changes
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear previous overlays
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    if (!expandedId) {
      // Reset to overview
      const vlat = parseFloat(venueLat);
      const vlng = parseFloat(venueLng);
      const olat = parseFloat(originLat);
      const olng = parseFloat(originLng);
      if (vlat && vlng && olat && olng) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend({ lat: olat, lng: olng });
        bounds.extend({ lat: vlat, lng: vlng });
        mapRef.current.fitBounds(bounds, 60);
      } else if (vlat && vlng) {
        mapRef.current.setCenter({ lat: vlat, lng: vlng });
        mapRef.current.setZoom(5);
      }
      return;
    }

    const it = itineraries.find((i) => i.id === expandedId);
    if (!it || it.legs.length === 0) return;

    const bounds = new google.maps.LatLngBounds();

    for (let li = 0; li < it.legs.length; li++) {
      const leg = it.legs[li];
      const color = modeMapColor(leg.mode);
      const from = { lat: leg.fromLat, lng: leg.fromLng };
      const to = { lat: leg.toLat, lng: leg.toLng };
      bounds.extend(from);
      bounds.extend(to);

      if (leg.mode === "drive" || leg.mode === "rideshare") {
        // Use Directions Service for road route polyline
        if (directionsServiceRef.current) {
          directionsServiceRef.current.route(
            {
              origin: from,
              destination: to,
              travelMode: google.maps.TravelMode.DRIVING,
            },
            (result, status) => {
              if (status === "OK" && result) {
                const path = result.routes[0]?.overview_path;
                if (path) {
                  const polyline = new google.maps.Polyline({
                    path,
                    strokeColor: color,
                    strokeWeight: 5,
                    strokeOpacity: 0.85,
                    map: mapRef.current,
                  });
                  overlaysRef.current.push(polyline);
                }
              } else {
                // Fallback: straight line
                const polyline = new google.maps.Polyline({
                  path: [from, to],
                  strokeColor: color,
                  strokeWeight: 4,
                  strokeOpacity: 0.7,
                  map: mapRef.current,
                });
                overlaysRef.current.push(polyline);
              }
            }
          );
        }
      } else if (leg.mode === "flight") {
        // Geodesic arc for flights
        const polyline = new google.maps.Polyline({
          path: [from, to],
          geodesic: true,
          strokeColor: color,
          strokeWeight: 3,
          strokeOpacity: 0,
          icons: [
            {
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: 0.8,
                strokeColor: color,
                scale: 3,
              },
              offset: "0",
              repeat: "12px",
            },
          ],
          map: mapRef.current,
        });
        overlaysRef.current.push(polyline);
      } else {
        // Bus/train: solid polyline between stops
        const polyline = new google.maps.Polyline({
          path: [from, to],
          strokeColor: color,
          strokeWeight: 5,
          strokeOpacity: 0.85,
          map: mapRef.current,
        });
        overlaysRef.current.push(polyline);
      }

      // Add leg start marker (small circle)
      const marker = new google.maps.Marker({
        position: from,
        map: mapRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        title: leg.from,
        zIndex: 10,
      });
      overlaysRef.current.push(marker);

      // Add end marker for last leg
      if (li === it.legs.length - 1) {
        const endMarker = new google.maps.Marker({
          position: to,
          map: mapRef.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#111827",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
          title: leg.to,
          zIndex: 11,
        });
        overlaysRef.current.push(endMarker);
      }
    }

    mapRef.current.fitBounds(bounds, 60);
  }, [expandedId, itineraries, venueLat, venueLng, originLat, originLng]);

  const gameDisplay = game || `${venue}`;
  const dateDisplay = date
    ? new Date(date + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";
  const timeDisplay = time
    ? (() => {
        const [h, m] = time.split(":").map(Number);
        const p = h >= 12 ? "PM" : "AM";
        return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${p}`;
      })()
    : "";

  // Compute unique modes for each itinerary (merge drive/rideshare)
  const getMainModes = (it: Itinerary) => [
    ...new Set(
      it.legs.map((l) => (l.mode === "rideshare" ? "drive" : l.mode))
    ),
  ];

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="glass z-10 px-4 py-3 border-b border-gray-200 shrink-0">
        <div className="mx-auto">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold text-gray-900 truncate">
                {gameDisplay}
              </h1>
              <p className="text-xs text-gray-500">
                {dateDisplay} {timeDisplay && `· ${timeDisplay} EST`}{" "}
                {venue && `· ${venue}`}
              </p>
            </div>
          </div>
          {/* Editable origin */}
          <div className="mt-2 relative">
            <div className="flex items-center gap-2">
              <MapPin className="size-3.5 text-gray-400 shrink-0" />
              <span className="text-xs text-gray-400 shrink-0">From:</span>
              <form
                className="flex-1 flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sugIdx >= 0 && originSuggestions[sugIdx]) {
                    selectOriginSuggestion(originSuggestions[sugIdx]);
                  } else {
                    geocodeOriginInput();
                  }
                }}
              >
                <input
                  type="text"
                  value={originInput}
                  onChange={(e) => {
                    setOriginInput(e.target.value);
                    if (originDebounce.current) clearTimeout(originDebounce.current);
                    originDebounce.current = setTimeout(
                      () => fetchOriginSuggestions(e.target.value),
                      200
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSugIdx((i) => Math.min(i + 1, originSuggestions.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSugIdx((i) => Math.max(i - 1, -1));
                    } else if (e.key === "Escape") {
                      setOriginSuggestions([]);
                    }
                  }}
                  onFocus={() => {
                    if (originInput) fetchOriginSuggestions(originInput);
                  }}
                  onBlur={() => {
                    // Delay to allow click on suggestions
                    setTimeout(() => setOriginSuggestions([]), 200);
                  }}
                  placeholder="Enter city or address"
                  className="flex-1 text-xs bg-white/60 border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300 placeholder:text-gray-400"
                />
                <button
                  type="submit"
                  disabled={originLoading || !originInput.trim()}
                  className="px-2.5 py-1.5 rounded-lg bg-gray-800 text-white text-xs font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  {originLoading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Go"
                  )}
                </button>
              </form>
            </div>
            {/* Autocomplete suggestions dropdown */}
            {originSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
                {originSuggestions.map((s, i) => (
                  <button
                    key={s.placeId}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectOriginSuggestion(s)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      i === sugIdx
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <div className="font-medium">{s.main}</div>
                    <div className="text-[10px] text-gray-400">{s.secondary}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 50/50 split: map + itinerary */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Map */}
        <div className="w-1/2 relative">
          <div ref={mapContainerRef} className="absolute inset-0" />
        </div>

        {/* Right: Itinerary list */}
        <div className="w-1/2 overflow-y-auto">

      {/* Mode filter bar */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
        <span className="text-xs text-gray-400 mr-1">Prefer:</span>
        {(
          [
            ["all", "All", null],
            ["bus", "Bus", Bus],
            ["train", "Train", TrainFront],
          ] as [
            "all" | "bus" | "train",
            string,
            typeof Bus | null,
          ][]
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTransitPref(key)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              transitPref === key
                ? key === "bus"
                  ? "bg-green-100 text-green-700"
                  : key === "train"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-200 text-gray-800"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {Icon && <Icon className="size-3" />}
            {label}
          </button>
        ))}
      </div>

      {/* Results */}
      <main className="px-4 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 className="size-8 animate-spin mb-3" />
            <p className="text-sm">Finding routes...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-500 text-sm">{error}</p>
            <button
              onClick={fetchItineraries}
              className="mt-3 text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Retry
            </button>
          </div>
        ) : itineraries.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Navigation className="size-8 mx-auto mb-3" />
            <p className="text-sm">No routes found</p>
            <p className="text-xs mt-1">
              No bus, train, or drive options available for this game
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {itineraries.map((it) => {
              const isExpanded = expandedId === it.id;
              const mainModes = getMainModes(it);
              const itEnrichments = enrichments[it.id];
              const isEnriching = enriching.has(it.id);

              return (
                <div
                  key={it.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 transition-colors"
                >
                  {/* Collapsed header */}
                  <button
                    className="w-full px-4 py-3 text-left"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : it.id)
                    }
                  >
                    <div className="flex items-center gap-3">
                      {/* Mode icons */}
                      <div className="flex items-center gap-1">
                        {mainModes.map((mode, i) => (
                          <span key={i} className={`${modeColor(mode)}`}>
                            {modeIcon(mode)}
                          </span>
                        ))}
                      </div>

                      {/* Times */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                          <span>{formatTime(it.departureTime)}</span>
                          <ArrowRight className="size-3 text-gray-400" />
                          <span>{formatTime(it.arrivalTime)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                          <span>{formatDuration(it.totalMinutes)}</span>
                          <span>·</span>
                          {it.totalCost != null ? (
                            <span className="text-emerald-600 font-medium">
                              ~${it.totalCost}
                            </span>
                          ) : (
                            <span className="text-gray-400">--</span>
                          )}
                          {it.legs.length > 1 && (
                            <>
                              <span>·</span>
                              <span>
                                {it.legs.filter(
                                  (l) =>
                                    l.mode === "bus" ||
                                    l.mode === "train" ||
                                    l.mode === "flight"
                                ).length}{" "}
                                leg
                                {it.legs.filter(
                                  (l) =>
                                    l.mode === "bus" ||
                                    l.mode === "train" ||
                                    l.mode === "flight"
                                ).length !== 1
                                  ? "s"
                                  : ""}
                              </span>
                            </>
                          )}
                          {!it.enriched && it.legs.some((l) => l.enrichable) && (
                            <>
                              <span>·</span>
                              <span className="text-amber-500 text-[10px]">
                                estimate
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Mode badges */}
                      <div className="flex gap-1 flex-wrap">
                        {mainModes.map((mode, i) => (
                          <span
                            key={i}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${modeBgColor(mode)}`}
                          >
                            {modeLabel(mode)}
                          </span>
                        ))}
                      </div>

                      {isExpanded ? (
                        <ChevronUp className="size-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="size-4 text-gray-400" />
                      )}
                    </div>
                  </button>

                  {/* Expanded timeline */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      {/* Enrich button */}
                      {!itEnrichments &&
                        it.legs.some((l) => l.enrichable) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              enrichItinerary(it);
                            }}
                            disabled={isEnriching}
                            className="mt-3 mb-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors disabled:opacity-50"
                          >
                            {isEnriching ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Zap className="size-3" />
                            )}
                            {isEnriching
                              ? "Getting real times..."
                              : "Get real driving times & prices"}
                          </button>
                        )}
                      {itEnrichments && (
                        <div className="mt-3 mb-1 flex items-center gap-1.5 text-xs text-emerald-600">
                          <Zap className="size-3" />
                          <span>Enriched with real Google Maps data</span>
                        </div>
                      )}

                      <div className="mt-3 space-y-0">
                        {it.legs.map((leg, i) => {
                          const prevLeg = i > 0 ? it.legs[i - 1] : null;
                          const gap = prevLeg
                            ? Math.round(
                                (new Date(leg.depart).getTime() -
                                  new Date(prevLeg.arrive).getTime()) /
                                  60000
                              )
                            : 0;

                          const enrichData = itEnrichments?.[i];
                          const swapKey = `${it.id}:${i}`;
                          const isSwapped = swappedToTransit.has(swapKey);

                          // If enriched and swapped to transit, show transit data instead
                          const displayMode =
                            isSwapped && enrichData?.transitMinutes != null
                              ? "transit"
                              : leg.mode;
                          const displayMinutes =
                            enrichData && !isSwapped
                              ? enrichData.driveMinutes
                              : isSwapped && enrichData?.transitMinutes != null
                                ? enrichData.transitMinutes
                                : leg.minutes;

                          return (
                            <div key={i}>
                              {/* Transfer gap / layover */}
                              {gap > 5 && (
                                <div className="flex items-center gap-2 py-1.5 pl-6 text-xs text-amber-600">
                                  <Clock className="size-3" />
                                  <span>
                                    {formatDuration(gap)} layover at{" "}
                                    {leg.from}
                                  </span>
                                </div>
                              )}

                              {/* Leg */}
                              <div className="flex gap-3 py-2">
                                {/* Timeline line */}
                                <div className="flex flex-col items-center w-5">
                                  <div
                                    className={`w-2 h-2 rounded-full ${
                                      displayMode === "rideshare"
                                        ? "bg-gray-300"
                                        : modeColor(displayMode).replace(
                                            "text-",
                                            "bg-"
                                          )
                                    }`}
                                  />
                                  <div className="flex-1 w-0.5 bg-gray-200" />
                                </div>

                                {/* Leg details */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className={modeColor(displayMode)}>
                                      {modeIcon(displayMode)}
                                    </span>
                                    <span className="text-sm font-medium text-gray-900">
                                      {leg.carrier || modeLabel(displayMode)}
                                      {leg.routeName && (
                                        <span className="text-gray-500 ml-1">
                                          {leg.routeName}
                                        </span>
                                      )}
                                    </span>
                                    {enrichData && !isSwapped && (
                                      <span className="text-[10px] text-emerald-500">
                                        (live)
                                      </span>
                                    )}
                                    {isSwapped && (
                                      <span className="text-[10px] text-teal-500">
                                        (transit)
                                      </span>
                                    )}
                                  </div>

                                  <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                                    <div className="flex items-center gap-1">
                                      <MapPin className="size-3" />
                                      <span>{leg.from}</span>
                                      <span className="text-gray-400">
                                        →
                                      </span>
                                      <span>{leg.to}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span>
                                        {formatTime(leg.depart)} →{" "}
                                        {formatTime(leg.arrive)}
                                      </span>
                                      <span>·</span>
                                      <span>
                                        ~{formatDuration(displayMinutes)}
                                      </span>
                                      {/* Show real prices only from enrichment */}
                                      {enrichData && !isSwapped && (
                                        <>
                                          {enrichData.uberEstimate && (
                                            <>
                                              <span>·</span>
                                              <span className="text-gray-600">
                                                Uber{" "}
                                                {enrichData.uberEstimate}
                                              </span>
                                            </>
                                          )}
                                          {enrichData.lyftEstimate && (
                                            <>
                                              <span>·</span>
                                              <span className="text-pink-500">
                                                Lyft{" "}
                                                {enrichData.lyftEstimate}
                                              </span>
                                            </>
                                          )}
                                        </>
                                      )}
                                      {isSwapped &&
                                        enrichData?.transitFare && (
                                          <>
                                            <span>·</span>
                                            <span className="text-emerald-600">
                                              {enrichData.transitFare}
                                            </span>
                                          </>
                                        )}
                                      {!enrichData &&
                                        leg.cost != null &&
                                        leg.cost > 0 && (
                                          <>
                                            <span>·</span>
                                            <span className="text-emerald-600">
                                              ~${leg.cost}
                                            </span>
                                          </>
                                        )}
                                      {leg.miles > 0 && (
                                        <>
                                          <span>·</span>
                                          <span>{leg.miles} mi</span>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {/* Action buttons */}
                                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                    {(displayMode === "drive" ||
                                      displayMode === "rideshare") && (
                                      <>
                                        <a
                                          href={uberUrl(
                                            leg.from,
                                            leg.fromLat,
                                            leg.fromLng,
                                            leg.to,
                                            leg.toLat,
                                            leg.toLng
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-black text-white hover:opacity-80 transition-opacity"
                                          onClick={(e) =>
                                            e.stopPropagation()
                                          }
                                        >
                                          Uber{" "}
                                          <ArrowRight className="size-3" />
                                        </a>
                                        <a
                                          href={lyftUrl(
                                            leg.fromLat,
                                            leg.fromLng,
                                            leg.toLat,
                                            leg.toLng
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-pink-600 text-white hover:opacity-80 transition-opacity"
                                          onClick={(e) =>
                                            e.stopPropagation()
                                          }
                                        >
                                          Lyft{" "}
                                          <ArrowRight className="size-3" />
                                        </a>
                                        <a
                                          href={
                                            leg.bookingUrl ||
                                            `https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=driving`
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:opacity-80 transition-opacity"
                                          onClick={(e) =>
                                            e.stopPropagation()
                                          }
                                        >
                                          Drive{" "}
                                          <ArrowRight className="size-3" />
                                        </a>
                                        {/* Swap to transit button */}
                                        {enrichData?.transitMinutes !=
                                          null && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleTransitSwap(swapKey);
                                            }}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors"
                                          >
                                            <ArrowLeftRight className="size-3" />
                                            {isSwapped
                                              ? `Back to drive (${formatDuration(enrichData.driveMinutes)}${enrichData.uberEstimate ? `, ~${enrichData.uberEstimate}` : ""})`
                                              : `Swap: transit (${formatDuration(enrichData.transitMinutes)}${enrichData.transitFare ? `, ~${enrichData.transitFare}` : ""})`}
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {displayMode === "transit" &&
                                      isSwapped && (
                                        <>
                                          <a
                                            href={`https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=transit`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700 hover:opacity-80 transition-opacity"
                                            onClick={(e) =>
                                              e.stopPropagation()
                                            }
                                          >
                                            Directions{" "}
                                            <ArrowRight className="size-3" />
                                          </a>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleTransitSwap(swapKey);
                                            }}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                                          >
                                            <ArrowLeftRight className="size-3" />
                                            {`Back to drive (${formatDuration(enrichData!.driveMinutes)}${enrichData!.uberEstimate ? `, ~${enrichData!.uberEstimate}` : ""})`}
                                          </button>
                                        </>
                                      )}
                                    {(displayMode === "bus" ||
                                      displayMode === "train") && (
                                      <>
                                        {leg.bookingUrl && (
                                          <a
                                            href={leg.bookingUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${modeBgColor(displayMode)} hover:opacity-80 transition-opacity`}
                                            onClick={(e) =>
                                              e.stopPropagation()
                                            }
                                          >
                                            Book{" "}
                                            <ArrowRight className="size-3" />
                                          </a>
                                        )}
                                      </>
                                    )}
                                    {displayMode === "transit" &&
                                      !isSwapped && (
                                        <a
                                          href={
                                            leg.bookingUrl ||
                                            `https://www.google.com/maps/dir/?api=1&origin=${leg.fromLat},${leg.fromLng}&destination=${leg.toLat},${leg.toLng}&travelmode=transit`
                                          }
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700 hover:opacity-80 transition-opacity"
                                          onClick={(e) =>
                                            e.stopPropagation()
                                          }
                                        >
                                          Directions{" "}
                                          <ArrowRight className="size-3" />
                                        </a>
                                      )}
                                    {displayMode === "flight" && (
                                      <>
                                        {leg.bookingUrl && (
                                          <a
                                            href={leg.bookingUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-violet-50 text-violet-700 hover:opacity-80 transition-opacity"
                                            onClick={(e) =>
                                              e.stopPropagation()
                                            }
                                          >
                                            Flights{" "}
                                            <ArrowRight className="size-3" />
                                          </a>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Arrival */}
                        <div className="flex gap-3 py-2">
                          <div className="flex flex-col items-center w-5">
                            <div className="w-2 h-2 rounded-full bg-gray-900" />
                          </div>
                          <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                            <MapPin className="size-4" />
                            Arrive at {venue}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => setResultLimit((l) => l + 10)}
              className="w-full mt-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              Show More Routes
            </button>
          </div>
        )}
      </main>
        </div>{/* close right panel */}
      </div>{/* close flex split */}
    </div>
  );
}
