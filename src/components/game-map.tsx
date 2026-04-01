"use client";

import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MapEvent {
  id: string;
  name: string;
  url: string;
  est_time: string | null;
  local_time?: string | null;
  tz?: string | null;
  date_time_utc?: string | null;
  venue: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  min_price: { amount: number; currency: string } | null;
  odds: {
    away_team: string;
    home_team: string;
    away_win: number;
    home_win: number;
    kalshi_event: string;
  } | null;
  nearbyAirports?: TransitStop[];
  nearbyTrainStations?: TransitStop[];
  nearbyBusStations?: TransitStop[];
}

export interface TransitStop {
  code: string;
  name: string;
  lat: number;
  lng: number;
  driveMinutes?: number;
  transitMinutes?: number | null;
}

export interface RouteFocus {
  venueLat: number;
  venueLng: number;
  airportLat: number;
  airportLng: number;
  airportCode: string;
  venueName: string;
  pinOnly?: boolean;
}

export interface VenueInfo {
  venue: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  games: {
    id: string;
    name: string;
    url: string;
    est_time: string | null;
    local_time?: string | null;
    tz?: string | null;
    date_time_utc?: string | null;
    min_price: { amount: number; currency: string } | null;
    odds: {
      away_team: string;
      home_team: string;
      away_win: number;
      home_win: number;
      kalshi_event: string;
    } | null;
    away_record?: string | null;
    home_record?: string | null;
  }[];
  airports: TransitStop[];
  trains: TransitStop[];
  buses: TransitStop[];
}

// Cache for OSRM route geometries
const routeCache = new Map<string, [number, number][]>();

async function fetchRouteGeometry(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<[number, number][] | null> {
  const key = `${fromLat},${fromLng};${toLat},${toLng}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!coords) return null;
    const latLngs: [number, number][] = coords.map((c: [number, number]) => [c[1], c[0]]);
    routeCache.set(key, latLngs);
    return latLngs;
  } catch {
    return null;
  }
}

export function GameMap({
  events,
  routeFocus,
  selectedVenue,
  onMarkerClick,
  onMarkerHover,
  hoveredVenue,
  userLocation,
  bottomPadding = 0,
  rampageActive = false,
  rampageGames = [],
  rampageStart,
  rampageEnd,
}: {
  events: MapEvent[];
  routeFocus?: RouteFocus | null;
  selectedVenue?: string | null;
  onMarkerClick?: (venue: VenueInfo) => void;
  onMarkerHover?: (venue: string | null) => void;
  hoveredVenue?: string | null;
  userLocation?: { lat: number; lng: number } | null;
  bottomPadding?: number;
  rampageActive?: boolean;
  rampageGames?: { id: string; venue: string; lat: number; lng: number; est_date: string }[];
  rampageStart?: { lat: number; lng: number; label: string } | null;
  rampageEnd?: { lat: number; lng: number; label: string } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ marker: L.Marker; venue: string; dot: HTMLDivElement }[]>([]);
  const overlayMarkersRef = useRef<L.Marker[]>([]);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const defaultBoundsRef = useRef<L.LatLngBounds | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const rampageMarkersRef = useRef<L.Marker[]>([]);
  const rampagePolylineRef = useRef<L.Polyline | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const leafletRef = useRef<typeof L | null>(null);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const onMarkerHoverRef = useRef(onMarkerHover);
  onMarkerHoverRef.current = onMarkerHover;
  const bottomPaddingRef = useRef(bottomPadding);
  bottomPaddingRef.current = bottomPadding;
  const routeFocusRef = useRef(routeFocus);
  routeFocusRef.current = routeFocus;
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // Initialize map once
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const Leaf = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      leafletRef.current = Leaf;

      const map = Leaf.map(containerRef.current, {
        center: [39.8, -98.5],
        zoom: 4,
        zoomControl: false,
        attributionControl: false,
      });

      Leaf.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      setMapReady(true);
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Update markers when events change
  useEffect(() => {
    const map = mapRef.current;
    const Leaf = leafletRef.current;
    if (!map || !mapReady || !Leaf) return;

    markersRef.current.forEach((m) => m.marker.remove());
    markersRef.current = [];

    const withCoords = events.filter(
      (e): e is MapEvent & { lat: number; lng: number } =>
        e.lat !== null && e.lng !== null
    );
    if (withCoords.length === 0) {
      defaultBoundsRef.current = null;
      return;
    }

    const bounds = Leaf.latLngBounds([]);

    const byVenue: Record<string, {
      lat: number; lng: number; venue: string; city: string; state: string;
      games: MapEvent[];
    }> = {};
    for (const e of withCoords) {
      const key = `${e.lat},${e.lng}`;
      if (!byVenue[key]) {
        byVenue[key] = { lat: e.lat, lng: e.lng, venue: e.venue, city: e.city, state: e.state, games: [] };
      }
      byVenue[key].games.push(e);
    }

    for (const v of Object.values(byVenue)) {
      const pos: [number, number] = [v.lat, v.lng];
      bounds.extend(pos);

      const dot = document.createElement("div");
      dot.style.cssText = "width:16px;height:16px;border-radius:50%;background:#d4a843;border:2.5px solid rgba(255,255,255,0.8);cursor:pointer;transition:all 150ms;";

      const icon = Leaf.divIcon({
        html: dot.outerHTML,
        className: "",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      const marker = Leaf.marker(pos, { icon }).addTo(map);

      marker.on("click", () => {
        const currentEvents = eventsRef.current;
        const venueGames = currentEvents.filter((e) => e.venue === v.venue);
        const firstWithAirports = venueGames.find((e) => e.nearbyAirports?.length);
        const firstWithTrains = venueGames.find((e) => e.nearbyTrainStations?.length);
        const firstWithBuses = venueGames.find((e) => e.nearbyBusStations?.length);

        const venueInfo: VenueInfo = {
          venue: v.venue,
          city: v.city,
          state: v.state,
          lat: v.lat,
          lng: v.lng,
          games: venueGames.map((g) => ({
            id: g.id,
            name: g.name,
            url: g.url,
            est_time: g.est_time,
            local_time: g.local_time,
            tz: g.tz,
            date_time_utc: g.date_time_utc,
            min_price: g.min_price,
            odds: g.odds,
          })),
          airports: firstWithAirports?.nearbyAirports ?? [],
          trains: firstWithTrains?.nearbyTrainStations ?? [],
          buses: firstWithBuses?.nearbyBusStations ?? [],
        };
        onMarkerClickRef.current?.(venueInfo);
      });

      // Store ref to actual dot in DOM for hover/selection styling
      const dotEl = marker.getElement()?.querySelector("div") as HTMLDivElement | null;

      if (dotEl) {
        dotEl.addEventListener("mouseenter", () => onMarkerHoverRef.current?.(v.venue));
        dotEl.addEventListener("mouseleave", () => onMarkerHoverRef.current?.(null));
      }

      markersRef.current.push({ marker, venue: v.venue, dot: dotEl ?? dot });
    }

    defaultBoundsRef.current = bounds;
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [events, mapReady]);

  // Highlight selected or hovered venue — green glow
  useEffect(() => {
    for (const { venue, dot } of markersRef.current) {
      if ((selectedVenue && venue === selectedVenue) || (hoveredVenue && venue === hoveredVenue)) {
        dot.style.background = "#22c55e";
        dot.style.width = "22px";
        dot.style.height = "22px";
        dot.style.boxShadow = "0 0 12px #22c55e80";
      } else {
        dot.style.background = "#d4a843";
        dot.style.width = "16px";
        dot.style.height = "16px";
        dot.style.boxShadow = "none";
      }
    }
  }, [selectedVenue, hoveredVenue]);

  // User location marker
  useEffect(() => {
    const map = mapRef.current;
    const Leaf = leafletRef.current;
    if (!map || !mapReady || !Leaf) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }

    if (userLocation) {
      const icon = Leaf.divIcon({
        html: '<div class="user-location-dot"></div>',
        className: "",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      userMarkerRef.current = Leaf.marker([userLocation.lat, userLocation.lng], { icon }).addTo(map);
    }
  }, [userLocation, mapReady]);

  // Re-fit bounds when bottom padding changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const rf = routeFocusRef.current;
    if (rf) {
      const Leaf = leafletRef.current!;
      const bounds = Leaf.latLngBounds([
        [rf.venueLat, rf.venueLng],
        [rf.airportLat, rf.airportLng],
      ]);
      map.fitBounds(bounds, { padding: [50, 50], paddingBottomRight: [0, bottomPadding] });
    } else if (defaultBoundsRef.current) {
      map.fitBounds(defaultBoundsRef.current, { padding: [40, 40], paddingBottomRight: [0, bottomPadding] });
    }
  }, [bottomPadding, mapReady]);

  // Route focus — overlay markers + route polyline
  useEffect(() => {
    const map = mapRef.current;
    const Leaf = leafletRef.current;
    if (!map || !mapReady || !Leaf) return;

    overlayMarkersRef.current.forEach((m) => m.remove());
    overlayMarkersRef.current = [];
    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
      routeLayerRef.current = null;
    }

    if (!routeFocus) {
      if (defaultBoundsRef.current) {
        map.fitBounds(defaultBoundsRef.current, { padding: [40, 40], paddingBottomRight: [0, bottomPaddingRef.current] });
      }
      return;
    }

    const venuePos: [number, number] = [routeFocus.venueLat, routeFocus.venueLng];
    const airportPos: [number, number] = [routeFocus.airportLat, routeFocus.airportLng];

    const venueIcon = Leaf.divIcon({
      html: '<div style="width:20px;height:20px;border-radius:50%;background:#22c55e;border:2px solid rgba(255,255,255,0.8);"></div>',
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const venueMarker = Leaf.marker(venuePos, { icon: venueIcon, title: routeFocus.venueName }).addTo(map);
    overlayMarkersRef.current.push(venueMarker);

    const airportIcon = Leaf.divIcon({
      html: '<div style="width:20px;height:20px;border-radius:50%;background:#d4a843;border:2px solid rgba(255,255,255,0.8);"></div>',
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const airportMarker = Leaf.marker(airportPos, { icon: airportIcon, title: routeFocus.airportCode }).addTo(map);
    overlayMarkersRef.current.push(airportMarker);

    const bounds = Leaf.latLngBounds([venuePos, airportPos]);
    map.fitBounds(bounds, { padding: [50, 50], paddingBottomRight: [0, bottomPaddingRef.current] });

    if (!routeFocus.pinOnly) {
      fetchRouteGeometry(routeFocus.venueLat, routeFocus.venueLng, routeFocus.airportLat, routeFocus.airportLng)
        .then((coords) => {
          if (coords && mapRef.current) {
            routeLayerRef.current = Leaf.polyline(coords, {
              color: "#d4a843",
              weight: 4,
              opacity: 0.8,
            }).addTo(mapRef.current);
          }
        });
    }
  }, [routeFocus, mapReady]);

  // Rampage overlay: numbered markers + connecting polyline
  useEffect(() => {
    const Leaf = leafletRef.current;
    rampageMarkersRef.current.forEach((m) => m.remove());
    rampageMarkersRef.current = [];
    if (rampagePolylineRef.current) {
      rampagePolylineRef.current.remove();
      rampagePolylineRef.current = null;
    }

    if (!mapReady || !mapRef.current || !Leaf || !rampageActive || rampageGames.length === 0) return;

    const map = mapRef.current;
    const points: [number, number][] = [];

    if (rampageStart) points.push([rampageStart.lat, rampageStart.lng]);

    rampageGames.forEach((game, i) => {
      points.push([game.lat, game.lng]);

      const icon = Leaf.divIcon({
        html: `<div style="width:24px;height:24px;border-radius:50%;background:#60a5fa;color:white;font-family:monospace;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.8);box-shadow:0 2px 8px rgba(59,130,246,0.5);">${i + 1}</div>`,
        className: "",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = Leaf.marker([game.lat, game.lng], { icon, zIndexOffset: 1000 + i }).addTo(map);
      rampageMarkersRef.current.push(marker);
    });

    if (rampageEnd) points.push([rampageEnd.lat, rampageEnd.lng]);

    if (points.length >= 2) {
      rampagePolylineRef.current = Leaf.polyline(points, {
        color: "#60a5fa",
        weight: 2,
        opacity: 0.6,
        dashArray: "8 8",
      }).addTo(map);
    }
  }, [rampageActive, rampageGames, rampageStart, rampageEnd, mapReady]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-dvw h-dvh z-0 min-[867px]:w-1/2 min-[867px]:right-auto"
    />
  );
}
