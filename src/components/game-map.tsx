"use client";

import { useEffect, useRef } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let mapsReady: Promise<void> | null = null;

function ensureMaps(): Promise<void> {
  if (!mapsReady) {
    setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "", v: "weekly" });
    mapsReady = Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
      importLibrary("routes"),
    ]).then(() => {});
  }
  return mapsReady;
}

interface MapEvent {
  id: string;
  name: string;
  est_time: string | null;
  venue: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
}

export interface RouteFocus {
  venueLat: number;
  venueLng: number;
  airportLat: number;
  airportLng: number;
  airportCode: string;
  venueName: string;
}

export interface VenueFocus {
  lat: number;
  lng: number;
  name: string;
}

// Directions result cache


// Cache directions results
const directionsCache = new Map<string, google.maps.DirectionsResult>();

export function GameMap({
  events,
  routeFocus,
  venueFocus,
}: {
  events: MapEvent[];
  routeFocus?: RouteFocus | null;
  venueFocus?: VenueFocus | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const overlayMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const defaultBoundsRef = useRef<google.maps.LatLngBounds | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // Initialize map
  useEffect(() => {
    let cancelled = false;

    async function init() {
      await ensureMaps();
      if (cancelled || !containerRef.current) return;

      const withCoords = events.filter(
        (e): e is MapEvent & { lat: number; lng: number } =>
          e.lat !== null && e.lng !== null
      );
      if (withCoords.length === 0) return;

      // Clean up old map
      if (mapRef.current) {
        // clear markers
        markersRef.current.forEach((m) => (m.map = null));
        markersRef.current = [];
      }

      const map = new google.maps.Map(containerRef.current, {
        mapId: "DEMO_MAP_ID",
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "cooperative",
        colorScheme: "DARK",
      });
      mapRef.current = map;
      infoWindowRef.current = new google.maps.InfoWindow();
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: "#3b82f6",
          strokeWeight: 4,
          strokeOpacity: 0.8,
        },
      });

      const bounds = new google.maps.LatLngBounds();

      // Group events by venue
      const byVenue: Record<
        string,
        {
          lat: number;
          lng: number;
          venue: string;
          city: string;
          state: string;
          games: { name: string; est_time: string | null }[];
        }
      > = {};
      for (const e of withCoords) {
        const key = `${e.lat},${e.lng}`;
        if (!byVenue[key]) {
          byVenue[key] = {
            lat: e.lat,
            lng: e.lng,
            venue: e.venue,
            city: e.city,
            state: e.state,
            games: [],
          };
        }
        byVenue[key].games.push({ name: e.name, est_time: e.est_time });
      }

      for (const v of Object.values(byVenue)) {
        const pos = { lat: v.lat, lng: v.lng };
        bounds.extend(pos);

        const dot = document.createElement("div");
        dot.style.cssText =
          "width:16px;height:16px;border-radius:50%;background:#1d4ed8;border:2px solid #fff;cursor:pointer;";

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: pos,
          content: dot,
        });

        const gameLines = v.games
          .map((g) => {
            const time = g.est_time ? formatTimePopup(g.est_time) : "TBD";
            return `<div style="margin-bottom:4px"><strong>${time}</strong> ${g.name}</div>`;
          })
          .join("");

        const popupHtml = `
          <div style="min-width:200px;color:#222">
            <div style="font-weight:700;font-size:14px;margin-bottom:2px">${v.venue}</div>
            <div style="color:#666;font-size:12px;margin-bottom:8px">${v.city}, ${v.state}</div>
            ${gameLines}
          </div>
        `;

        marker.addListener("click", () => {
          infoWindowRef.current?.setContent(popupHtml);
          infoWindowRef.current?.open({ anchor: marker, map });
        });

        markersRef.current.push(marker);
      }

      defaultBoundsRef.current = bounds;

      if (Object.keys(byVenue).length === 1) {
        const only = Object.values(byVenue)[0];
        map.setCenter({ lat: only.lat, lng: only.lng });
        map.setZoom(6);
      } else {
        map.fitBounds(bounds, 40);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [events]);

  // Handle route/venue focus
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear overlay markers
    overlayMarkersRef.current.forEach((m) => (m.map = null));
    overlayMarkersRef.current = [];
    directionsRendererRef.current?.setDirections({ routes: [] } as unknown as google.maps.DirectionsResult);

    const activeFocus = routeFocus || venueFocus;
    if (!activeFocus) {
      // Restore default view
      if (defaultBoundsRef.current) {
        map.fitBounds(defaultBoundsRef.current, 40);
      }
      return;
    }

    // Venue-only focus
    if (!routeFocus && venueFocus) {
      const pos = { lat: venueFocus.lat, lng: venueFocus.lng };

      const dot = document.createElement("div");
      dot.style.cssText =
        "width:20px;height:20px;border-radius:50%;background:#22c55e;border:2px solid #fff;";
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: pos,
        content: dot,
        title: venueFocus.name,
      });
      overlayMarkersRef.current.push(marker);

      map.setCenter(pos);
      map.setZoom(13);
      return;
    }

    // Route focus
    if (routeFocus) {
      const venuePos = { lat: routeFocus.venueLat, lng: routeFocus.venueLng };
      const airportPos = { lat: routeFocus.airportLat, lng: routeFocus.airportLng };

      // Venue marker (green)
      const venueDot = document.createElement("div");
      venueDot.style.cssText =
        "width:20px;height:20px;border-radius:50%;background:#22c55e;border:2px solid #fff;";
      const venueMarker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: venuePos,
        content: venueDot,
        title: routeFocus.venueName,
      });
      overlayMarkersRef.current.push(venueMarker);

      // Airport marker (orange)
      const airportDot = document.createElement("div");
      airportDot.style.cssText =
        "width:20px;height:20px;border-radius:50%;background:#f97316;border:2px solid #fff;";
      const airportMarker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: airportPos,
        content: airportDot,
        title: routeFocus.airportCode,
      });
      overlayMarkersRef.current.push(airportMarker);

      // Fit both points
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(venuePos);
      bounds.extend(airportPos);
      map.fitBounds(bounds, 50);

      // Fetch and render driving directions
      const cacheKey = `${routeFocus.venueLat},${routeFocus.venueLng};${routeFocus.airportLat},${routeFocus.airportLng}`;
      const cached = directionsCache.get(cacheKey);
      if (cached) {
        directionsRendererRef.current?.setDirections(cached);
      } else {
        const svc = new google.maps.DirectionsService();
        svc.route(
          {
            origin: venuePos,
            destination: airportPos,
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (status === "OK" && result) {
              directionsCache.set(cacheKey, result);
              directionsRendererRef.current?.setDirections(result);
            }
          }
        );
      }
    }
  }, [routeFocus, venueFocus]);

  return (
    <div
      ref={containerRef}
      className="h-[300px] w-full rounded-lg border overflow-hidden"
    />
  );
}

function formatTimePopup(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
