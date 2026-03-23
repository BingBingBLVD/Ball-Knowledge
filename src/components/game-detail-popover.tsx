"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Clock,
  Ticket,
  Star,
  ArrowUpRight,
  Hotel,
  Car,
  Bus,
  Footprints,
  Check,
  Ban,
  ShieldCheck,
} from "lucide-react";
import type { VenuePolicy } from "@/lib/venue-policies";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PopoverGame {
  id: string;
  name: string;
  venue: string;
  city: string;
  state: string;
  est_date: string;
  est_time: string | null;
  local_time?: string | null;
  tz?: string | null;
  date_time_utc?: string | null;
  min_price: { amount: number; currency: string } | null;
  espn_price?: { amount: number; available: number; url: string | null } | null;
  odds?: { away_team: string; home_team: string; away_win: number; home_win: number; kalshi_event: string } | null;
  away_record?: string | null;
  home_record?: string | null;
  url?: string;
}

export interface PopoverHotel {
  name: string;
  vicinity: string;
  rating: number | null;
  priceLevel: number | null;
  estimatedPrice: string;
  bookingUrl: string;
  photoUrl?: string | null;
  lat: number;
  lng: number;
  distanceMiles: number;
  driveMinutes: number;
  walkMinutes: number;
  transitMinutes: number | null;
  transitFare: string | null;
  transitDirectionsUrl: string;
  uberEstimate: string;
  lyftEstimate: string;
  directionsUrl: string;
}

export interface GameDetailPopoverProps {
  game: PopoverGame;
  visible: boolean;
  onClose: () => void;
  date?: string;
  distance?: number;
  policy?: VenuePolicy | null;
  hotels?: PopoverHotel[];
  children?: ReactNode;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(time: string | null, tz?: string | null): string {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period} ${tz ?? "ET"}`;
}

function formatUserLocalTime(utc: string | null | undefined): { text: string; tz: string } | null {
  if (!utc) return null;
  const d = new Date(utc);
  if (isNaN(d.getTime())) return null;
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: userTz, hour: "numeric", minute: "2-digit", hour12: true });
  const tzFmt = new Intl.DateTimeFormat("en-US", { timeZone: userTz, timeZoneName: "short" });
  const tzAbbr = tzFmt.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
  return { text: timeFmt.format(d).replace(/\u202f/g, " "), tz: tzAbbr };
}

// ── Component ──────────────────────────────────────────────────────────────

export function GameDetailPopover({
  game,
  visible,
  onClose,
  date,
  distance,
  policy,
  hotels,
  children,
}: GameDetailPopoverProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    const titleEl = titleRef.current;
    if (!el || !titleEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { root: el, threshold: 0 }
    );
    observer.observe(titleEl);
    return () => observer.disconnect();
  }, []);

  // Parse teams
  const parts = game.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
  const home = parts[0].replace(/\s*\(.*?\)/g, "").trim();
  const away = parts.length > 1 ? parts.slice(1).join(" vs ").replace(/\s*\(.*?\)/g, "").trim() : null;
  const price = game.espn_price?.amount ?? game.min_price?.amount;
  const displayDate = game.est_date || date || "";
  const userLocal = formatUserLocalTime(game.date_time_utc);
  const showLocal = userLocal && userLocal.tz !== (game.tz ?? "ET");
  const kalshiUrl = game.odds ? `https://kalshi.com/markets/KXNBAGAME/${game.odds.kalshi_event}` : null;
  const ticketmasterUrl = game.url || `https://www.ticketmaster.com/event/${game.id}`;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-white/70 backdrop-blur-md" />

      <div
        className={`absolute inset-0 bg-white overflow-hidden flex flex-col transition-transform duration-300 ease-out ${visible ? "translate-y-0" : "translate-y-full"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white border-b border-neutral-200">
          <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-neutral-100 transition-colors shrink-0">
                <X className="size-5 text-neutral-600" />
              </button>
              <div className={`transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`}>
                {away ? (
                  <>
                    <div className="text-sm font-semibold text-neutral-900 leading-tight truncate">{away}</div>
                    <div className="text-xs text-neutral-500 leading-tight truncate">@ {home}</div>
                  </>
                ) : (
                  <div className="text-sm font-semibold text-neutral-900 leading-tight truncate">{game.name}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {price != null && <span className="text-sm font-semibold">From ${price}</span>}
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar">
          <div className="max-w-3xl mx-auto px-6">
            {/* Title section */}
            <div ref={titleRef} className="pt-8 pb-6">
              {away ? (
                <h1 className="text-[26px] font-bold text-neutral-900 leading-tight">
                  {away} <span className="text-neutral-400 font-normal">@</span> {home}
                </h1>
              ) : (
                <h1 className="text-[26px] font-bold text-neutral-900 leading-tight">{game.name}</h1>
              )}
              <div className="flex items-center gap-1 mt-2 text-sm text-neutral-500">
                <span>{game.venue}</span>
                <span className="text-neutral-300">·</span>
                <span>{game.city}, {game.state}</span>
                {distance != null && <><span className="text-neutral-300">·</span><span>{Math.round(distance)} miles away</span></>}
              </div>
            </div>

            {/* Key details row */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-6 border-b border-neutral-200">
              <div className="flex items-center gap-2">
                <Clock className="size-5 text-neutral-400" />
                <div>
                  <div className="text-sm font-semibold text-neutral-900">{formatTime(game.local_time ?? game.est_time, game.tz)}</div>
                  <div className="text-xs text-neutral-500">{displayDate ? new Date(displayDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : ""}</div>
                  {showLocal && <div className="text-xs text-neutral-500">{userLocal.text} your time</div>}
                </div>
              </div>
              {price != null && (
                <div className="flex items-center gap-2">
                  <Ticket className="size-5 text-neutral-400" />
                  <div>
                    <div className={`text-sm font-semibold ${price < 30 ? "text-emerald-600" : "text-neutral-900"}`}>From ${price}</div>
                    {game.espn_price?.available != null && game.espn_price.available > 0 && (
                      <div className="text-xs text-neutral-500">{game.espn_price.available.toLocaleString()} left</div>
                    )}
                  </div>
                </div>
              )}
              {game.away_record && game.home_record && away && (
                <div className="flex items-center gap-2">
                  <Star className="size-5 text-neutral-400" />
                  <div className="text-sm">
                    <div className="font-semibold text-neutral-900">{home} {game.home_record}</div>
                    <div className="text-xs text-neutral-500">{away} {game.away_record}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Odds section */}
            {game.odds && away && (
              <div className="py-8 border-b border-neutral-200">
                <h2 className="text-[22px] font-semibold text-neutral-900 mb-4">Win probability</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-base text-neutral-600">{away}</span>
                    <span className="text-base font-semibold text-neutral-900">{game.odds.away_win}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden flex">
                    <div className="h-full rounded-l-full bg-neutral-900" style={{ width: `${game.odds.away_win}%` }} />
                    <div className="h-full rounded-r-full bg-neutral-300" style={{ width: `${game.odds.home_win}%` }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-base text-neutral-600">{home}</span>
                    <span className="text-base font-semibold text-neutral-900">{game.odds.home_win}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Injected children (for page-specific sections like weather, injuries, transit, etc.) */}
            {children}

            {/* Venue Policy — "Things to know" */}
            {policy && (() => {
              const allowed = policy.items.filter((i) => i.allowed);
              const prohibited = policy.items.filter((i) => !i.allowed);
              return (
                <div className="py-8 border-b border-neutral-200">
                  <h2 className="text-[22px] font-semibold text-neutral-900 mb-4">Things to know</h2>
                  <div>
                    {(policy.clearBagRequired || policy.maxBagSize) && (
                      <div className="text-sm text-neutral-700 mb-4 p-3 bg-amber-50 rounded-xl border border-amber-200">
                        {policy.clearBagRequired && <span className="font-semibold">Clear bag required</span>}
                        {policy.maxBagSize && <span>{policy.clearBagRequired ? " · " : ""}Max {policy.maxBagSize}</span>}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-6">
                      {allowed.length > 0 && <div><h3 className="text-sm font-semibold text-neutral-900 mb-2">Allowed</h3><div className="space-y-2">{allowed.map((item) => <div key={item.name} className="flex items-start gap-2 text-sm text-neutral-600"><Check className="size-4 shrink-0 mt-0.5 text-emerald-600" /><span>{item.name}</span></div>)}</div></div>}
                      {prohibited.length > 0 && <div><h3 className="text-sm font-semibold text-neutral-900 mb-2">Not allowed</h3><div className="space-y-2">{prohibited.map((item) => <div key={item.name} className="flex items-start gap-2 text-sm text-neutral-600"><Ban className="size-4 shrink-0 mt-0.5 text-red-500" /><span>{item.name}</span></div>)}</div></div>}
                    </div>
                    {policy.policyUrl && <a href={policy.policyUrl} target="_blank" rel="noopener noreferrer" className="mt-4 text-sm text-neutral-900 underline font-semibold inline-flex items-center gap-1 hover:text-neutral-600">Show full policy <ArrowUpRight className="size-3.5" /></a>}
                  </div>
                </div>
              );
            })()}

            {/* Hotels — "Where to stay" */}
            {hotels && hotels.length > 0 && (
              <div className="py-8 border-b border-neutral-200">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[22px] font-semibold text-neutral-900">Where to stay</h2>
                  <a href={hotels[0].bookingUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-neutral-900 underline hover:text-neutral-600">Browse more on Google</a>
                </div>
                <div className="flex gap-4 overflow-x-auto no-scrollbar -mx-6 px-6 pb-2">
                  {hotels.map((h, hi) => (
                    <a key={hi} href={h.bookingUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 w-[240px] rounded-xl overflow-hidden hover:shadow-lg transition-shadow no-underline block group">
                      <div className="h-[160px] bg-neutral-100 overflow-hidden">
                        {h.photoUrl ? (
                          <img src={h.photoUrl} alt={h.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-400"><Hotel className="size-10" /></div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-neutral-900 truncate flex-1">{h.name}</div>
                          {h.rating && <span className="flex items-center gap-0.5 text-sm shrink-0 ml-2"><Star className="size-3.5 text-neutral-900" /> {h.rating}</span>}
                        </div>
                        <div className="text-sm text-neutral-500 mt-0.5">{h.distanceMiles} mi from venue</div>
                        <div className="text-sm font-semibold text-neutral-900 mt-1">{h.estimatedPrice}</div>
                        <div className="flex items-center gap-2 mt-2 text-xs text-neutral-500">
                          <span className="flex items-center gap-1"><Car className="size-3" /> {h.driveMinutes}m</span>
                          {h.transitMinutes != null && <span className="flex items-center gap-1"><Bus className="size-3" /> {h.transitMinutes}m</span>}
                          <span className="flex items-center gap-1"><Footprints className="size-3" /> {h.walkMinutes}m</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Links — "Tickets & links" */}
            <div className="py-8">
              <h2 className="text-[22px] font-semibold text-neutral-900 mb-4">Tickets & links</h2>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Ticketmaster", href: ticketmasterUrl, icon: "https://www.google.com/s2/favicons?domain=ticketmaster.com&sz=32" },
                  game.espn_price?.url ? { label: "VividSeats", href: game.espn_price.url, icon: "https://www.google.com/s2/favicons?domain=vividseats.com&sz=32" } : null,
                  kalshiUrl ? { label: "Kalshi", href: kalshiUrl, icon: "https://www.google.com/s2/favicons?domain=kalshi.com&sz=32" } : null,
                  { label: "ESPN", href: `https://www.espn.com/nba/scoreboard/_/date/${displayDate.replace(/-/g, "")}`, icon: "https://www.google.com/s2/favicons?domain=espn.com&sz=32" },
                  policy?.websiteUrl ? { label: "Venue site", href: policy.websiteUrl, icon: "https://www.google.com/s2/favicons?domain=" + new URL(policy.websiteUrl).hostname + "&sz=32" } : null,
                ].filter(Boolean).map((link) => (
                  <a key={link!.label} href={link!.href} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-lg border border-neutral-200 text-sm font-medium text-neutral-900 hover:bg-neutral-50 hover:shadow-sm no-underline transition-all inline-flex items-center gap-2">
                    <img src={(link as { icon: string }).icon} alt="" className="size-4 rounded-sm" />
                    {link!.label}
                    <ArrowUpRight className="size-3.5 text-neutral-400" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
