"use client";

import { useState, useMemo } from "react";
import routesRaw from "../../data/frontier-routes.json";
import { getAllCities } from "@/lib/pathfinder";
import { haversineKm, cityCoords } from "@/lib/frontier-coords";
import { cityToIata } from "@/lib/frontier";

const allCitiesAlpha = getAllCities(routesRaw as { from: string; to: string }[]);
export { allCitiesAlpha };

export function CityInputMulti({
  id,
  label,
  values,
  onChange,
  userCoords,
  suggestCoords,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  userCoords: [number, number] | null;
  suggestCoords?: [number, number] | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const suggested = useMemo(() => {
    const ref: [number, number] | null =
      suggestCoords !== undefined
        ? suggestCoords
        : values.length > 0 && cityCoords[values[0]] ? cityCoords[values[0]] : null;
    if (!ref) return [];
    return allCitiesAlpha
      .filter((c) => !values.includes(c) && cityCoords[c])
      .map((c) => ({
        city: c,
        iata: cityToIata[c],
        distMi: Math.round(haversineKm(ref[0], ref[1], cityCoords[c][0], cityCoords[c][1]) * 0.621371),
      }))
      .sort((a, b) => a.distMi - b.distMi)
      .slice(0, 5);
  }, [values, suggestCoords]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return allCitiesAlpha
      .filter((c) => !values.includes(c))
      .map((c) => ({ city: c, iata: cityToIata[c] }))
      .filter((o) => !q || o.city.toLowerCase().includes(q) || (o.iata && o.iata.toLowerCase().startsWith(q)));
  }, [query, values]);

  function select(city: string) { onChange([...values, city]); setQuery(""); }
  function remove(city: string) { onChange(values.filter((c) => c !== city)); }

  const showSuggested = !query && suggested.length > 0;

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      <div
        className="min-h-[38px] w-full border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus-within:ring-2 focus-within:ring-emerald-500 flex flex-wrap gap-1.5 items-center cursor-text"
        onClick={() => setOpen(true)}
      >
        {values.map((city) => (
          <span key={city} className="flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold rounded-md px-2 py-0.5 shrink-0">
            <span className="font-mono">{cityToIata[city] ?? city}</span>
            <button
              type="button"
              className="text-emerald-400 hover:text-emerald-700 leading-none ml-0.5"
              onMouseDown={(e) => { e.stopPropagation(); remove(city); }}
            >
              x
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={query}
          autoComplete="off"
          placeholder={values.length === 0 ? "City or airport code..." : "Add more..."}
          className="flex-1 min-w-[80px] text-sm outline-none bg-transparent py-0.5"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && (showSuggested || filtered.length > 0) && (
        <ul className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-xl mt-1 max-h-72 overflow-auto">
          {showSuggested && (
            <>
              <li className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50">
                Suggested
              </li>
              {suggested.map((opt) => (
                <li
                  key={opt.city}
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-emerald-50 hover:text-emerald-700 flex items-center justify-between gap-2"
                  onMouseDown={() => select(opt.city)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {opt.iata && (
                      <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded shrink-0">
                        {opt.iata}
                      </span>
                    )}
                    <span className="truncate text-gray-700">{opt.city}</span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{opt.distMi.toLocaleString()} mi</span>
                </li>
              ))}
              {filtered.length > 0 && (
                <li className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 border-t border-gray-100">
                  All airports
                </li>
              )}
            </>
          )}
          {filtered.map((opt) => (
            <li
              key={opt.city}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-emerald-50 hover:text-emerald-700 flex items-center gap-2"
              onMouseDown={() => select(opt.city)}
            >
              {opt.iata && (
                <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded shrink-0">
                  {opt.iata}
                </span>
              )}
              <span className="truncate text-gray-700">{opt.city}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
