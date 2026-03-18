"use client";

import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouteFocus, VenueFocus } from "@/components/game-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Calendar,
  MapPin,
  Clock,
  Ticket,
  Trophy,
  Plane,
} from "lucide-react";

function formatDriveTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const GameMap = dynamic(
  () => import("@/components/game-map").then((m) => m.GameMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] w-full animate-pulse rounded-lg border bg-muted" />
    ),
  }
);

interface GameEvent {
  id: string;
  name: string;
  url: string;
  est_date: string;
  est_time: string | null;
  venue: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  min_price: { amount: number; currency: string } | null;
  status: string;
  odds: {
    away_team: string;
    home_team: string;
    away_win: number;
    home_win: number;
    kalshi_event: string;
  } | null;
  nearbyAirports?: { code: string; name: string; lat: number; lng: number; driveMinutes: number; transitMinutes: number | null }[];
}

interface DateGroup {
  date: string;
  events: GameEvent[];
}

interface EventsResponse {
  total: number;
  date_count: number;
  dates: DateGroup[];
  updated_at: string;
}

function formatDateHeading(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeEST(time: string | null) {
  if (!time) return "TBD";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period} EST`;
}

function formatPrice(price: { amount: number; currency: string } | null) {
  if (!price) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price.amount);
}

function useESTClock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    function update() {
      setNow(
        new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }) + " EST"
      );
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface DateCardProps {
  group: DateGroup;
}

const DateCard = memo(function DateCard({
  group,
}: DateCardProps) {
  const [routeFocus, setRouteFocus] = useState<RouteFocus | null>(null);
  const [venueFocus, setVenueFocus] = useState<VenueFocus | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAirportHover = useCallback((focus: RouteFocus | null) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    if (focus) {
      setVenueFocus(null);
      setRouteFocus(focus);
    } else {
      hoverTimeout.current = setTimeout(() => setRouteFocus(null), 150);
    }
  }, []);

  const handleVenueHover = useCallback((focus: VenueFocus | null) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    if (focus) {
      setRouteFocus(null);
      setVenueFocus(focus);
    } else {
      hoverTimeout.current = setTimeout(() => setVenueFocus(null), 150);
    }
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3">
          <Calendar className="size-4 text-primary" />
          <span>{formatDateHeading(group.date)}</span>
          <Badge variant="secondary">
            {group.events.length} game
            {group.events.length !== 1 ? "s" : ""}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="mb-4 px-4">
          <GameMap events={group.events} routeFocus={routeFocus} venueFocus={venueFocus} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Price</TableHead>
              <TableHead>Game</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Nearby Airports</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.events.map((event) => {
              const airports = event.nearbyAirports ?? [];
              return (
                <TableRow key={event.id}>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {event.min_price ? formatPrice(event.min_price) : "--"}
                  </TableCell>
                  <TableCell className="font-medium">
                    {(() => {
                      const parts = event.name.split(/\s+(?:vs?\.?|VS\.?)\s+/);
                      if (parts.length < 2) return <a href={event.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{event.name}</a>;
                      const away = parts[0];
                      const home = parts.slice(1).join(" vs ");
                      const kalshiUrl = event.odds ? `https://kalshi.com/markets/KXNBAGAME/${event.odds.kalshi_event}` : null;
                      return (
                        <>
                          <span className="flex items-center justify-between gap-2">
                            <a href={event.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{away}</a>
                            {event.odds && kalshiUrl && (
                              <a href={kalshiUrl} target="_blank" rel="noopener noreferrer" className={`text-xs font-mono hover:underline ${event.odds.away_win > event.odds.home_win ? "font-semibold text-green-500" : "text-muted-foreground"}`}>
                                {event.odds.away_win}%
                              </a>
                            )}
                          </span>
                          <span className="flex items-center justify-between gap-2">
                            <a href={event.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{home}</a>
                            {event.odds && kalshiUrl && (
                              <a href={kalshiUrl} target="_blank" rel="noopener noreferrer" className={`text-xs font-mono hover:underline ${event.odds.home_win > event.odds.away_win ? "font-semibold text-green-500" : "text-muted-foreground"}`}>
                                {event.odds.home_win}%
                              </a>
                            )}
                          </span>
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="size-3.5" />
                      {formatTimeEST(event.est_time)}
                    </span>
                  </TableCell>
                  <TableCell
                    onMouseEnter={() => event.lat != null && event.lng != null ? handleVenueHover({ lat: event.lat, lng: event.lng, name: event.venue }) : undefined}
                    onMouseLeave={() => handleVenueHover(null)}
                  >
                    <a
                      href={event.lat && event.lng ? `https://www.google.com/maps/?q=${event.lat},${event.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.venue}, ${event.city}, ${event.state}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <MapPin className="size-3.5 shrink-0" />
                      {event.venue} — {event.city}, {event.state}
                    </a>
                  </TableCell>
                  <TableCell>
                    {airports.length > 0 ? (
                      <div className="flex flex-col gap-1 text-sm">
                        {airports.map((apt) => {
                          const hasCoords = event.lat != null && event.lng != null && apt.lat != null && apt.lng != null;
                          const mapsUrl = hasCoords
                            ? `https://www.google.com/maps/dir/${event.lat},${event.lng}/${apt.lat},${apt.lng}`
                            : null;
                          const focus: RouteFocus | null = hasCoords ? {
                            venueLat: event.lat!,
                            venueLng: event.lng!,
                            airportLat: apt.lat!,
                            airportLng: apt.lng!,
                            airportCode: apt.code,
                            venueName: event.venue,
                          } : null;
                          return (
                            <div
                              key={apt.code}
                              className="flex items-center gap-1.5 text-muted-foreground"
                              onMouseEnter={() => handleAirportHover(focus)}
                              onMouseLeave={() => handleAirportHover(null)}
                            >
                              <Plane className="size-3 shrink-0" />
                              <span className="font-mono font-semibold">{apt.code}</span>
                              {mapsUrl ? (
                                <a
                                  href={mapsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs hover:text-foreground hover:underline"
                                >
                                  ~{formatDriveTime(apt.driveMinutes)} drive
                                </a>
                              ) : (
                                <span className="text-xs">~{formatDriveTime(apt.driveMinutes)} drive</span>
                              )}
                              {apt.transitMinutes != null && (
                                hasCoords ? (
                                  <a
                                    href={`https://www.google.com/maps/dir/${event.lat},${event.lng}/${apt.lat},${apt.lng}/data=!4m2!4m1!3e3`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                                  >
                                    ~{formatDriveTime(apt.transitMinutes)} transit
                                  </a>
                                ) : (
                                  <span className="text-xs text-blue-400">~{formatDriveTime(apt.transitMinutes)} transit</span>
                                )
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
});

const DAYS_PER_BATCH = 3;

export default function Home() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [visibleDays, setVisibleDays] = useState(DAYS_PER_BATCH);
  const estNow = useESTClock();

  useEffect(() => {
    fetch("/api/events")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || "Failed to fetch events");
        }
        return res.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      data?.dates
        .map((group) => ({
          ...group,
          events: group.events.filter((e) => {
            if (!search) return true;
            const q = search.toLowerCase();
            return (
              e.name.toLowerCase().includes(q) ||
              e.venue.toLowerCase().includes(q) ||
              e.city.toLowerCase().includes(q) ||
              e.state.toLowerCase().includes(q)
            );
          }),
        }))
        .filter((group) => group.events.length > 0),
    [data, search]
  );

  const totalFiltered = filtered?.length ?? 0;
  const hasMore = visibleDays < totalFiltered;
  const visible = useMemo(
    () => filtered?.slice(0, visibleDays),
    [filtered, visibleDays]
  );

  // Reset visible count when search changes
  useEffect(() => {
    setVisibleDays(DAYS_PER_BATCH);
  }, [search]);

  const loadMore = useCallback(() => {
    setVisibleDays((v) => v + DAYS_PER_BATCH);
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-baseline justify-between">
            <h1 className="flex items-center gap-2 text-4xl font-bold tracking-tight">
              <Trophy className="size-8 text-primary" />
              Ball Knowledge
            </h1>
            <span className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground">
              <Clock className="size-3.5" />
              {estNow}
            </span>
          </div>
          <p className="mt-2 text-muted-foreground">
            NBA games sorted by date, grouped by game day. All times in EST.
          </p>
          <Separator className="mt-4" />
        </div>

        {/* Search */}
        <div className="relative mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by team, arena, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-64" />
                </CardHeader>
                <CardContent className="px-0">
                  <Skeleton className="mx-4 mb-4 h-[300px] w-[calc(100%-2rem)] rounded-lg" />
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="flex items-center gap-4 px-4 py-3">
                      <Skeleton className="h-4 w-[40%]" />
                      <Skeleton className="h-4 w-[15%]" />
                      <Skeleton className="h-4 w-[25%]" />
                      <Skeleton className="h-4 w-[10%]" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <p className="font-medium text-destructive">Error: {error}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Make sure your Ticketmaster API key is set in{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  .env.local
                </code>{" "}
                as{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  TICKETMASTER_API_KEY
                </code>
              </p>
            </CardContent>
          </Card>
        )}

        {/* Data loaded */}
        {data && (
          <>
            {/* Stats badges */}
            <div className="mb-4 flex items-center gap-3">
              <Badge variant="outline">
                <Ticket className="size-3" />
                {data.total} upcoming games
              </Badge>
              <Badge variant="outline">
                <Calendar className="size-3" />
                {data.date_count} game days
              </Badge>
            </div>

            {/* No results */}
            {filtered && filtered.length === 0 && (
              <div className="flex flex-col items-center py-12 text-muted-foreground">
                <Search className="mb-3 size-8" />
                <p>No matches found for &quot;{search}&quot;</p>
              </div>
            )}

            {/* Game listings */}
            <div className="space-y-6">
              {visible?.map((group) => (
                <DateCard
                  key={group.date}
                  group={group}
                />
              ))}

              {hasMore && (
                <div className="flex justify-center py-6">
                  <Button
                    variant="outline"
                    onClick={loadMore}
                  >
                    Show more days ({totalFiltered - visibleDays} remaining)
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
