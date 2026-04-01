"use client";

import { useEffect, useRef } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Small embedded Leaflet map showing a driving route between two points via OSRM */
export function RouteMiniMap({
  fromLat,
  fromLng,
  toLat,
  toLng,
  height = 180,
}: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const Leaf = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = Leaf.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
      });

      Leaf.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      // Add markers
      const fromIcon = Leaf.divIcon({
        html: '<div style="width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid white;"></div>',
        className: "",
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });
      const toIcon = Leaf.divIcon({
        html: '<div style="width:10px;height:10px;border-radius:50%;background:#d4a843;border:2px solid white;"></div>',
        className: "",
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });

      Leaf.marker([fromLat, fromLng], { icon: fromIcon }).addTo(map);
      Leaf.marker([toLat, toLng], { icon: toIcon }).addTo(map);

      // Fetch route from OSRM and draw it
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          const coords = data?.routes?.[0]?.geometry?.coordinates;
          if (coords && !cancelled) {
            const latLngs: [number, number][] = coords.map((c: [number, number]) => [c[1], c[0]]);
            Leaf.polyline(latLngs, { color: "#d4a843", weight: 3, opacity: 0.8 }).addTo(map);
            map.fitBounds(Leaf.latLngBounds(latLngs), { padding: [20, 20] });
            return;
          }
        }
      } catch { /* fallback to simple bounds */ }

      // Fallback: just fit to the two markers
      map.fitBounds(Leaf.latLngBounds([[fromLat, fromLng], [toLat, toLng]]), { padding: [20, 20] });
    }

    init();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [fromLat, fromLng, toLat, toLng]);

  return (
    <div
      ref={containerRef}
      className="rounded-lg overflow-hidden border border-black/5"
      style={{ height, width: "100%" }}
    />
  );
}
