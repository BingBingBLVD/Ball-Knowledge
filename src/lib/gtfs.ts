import fs from "fs";
import path from "path";

// ── Raw JSON shape ────────────────────────────────────────────────────────

interface RawStop {
  n: string;
  lat: number;
  lng: number;
}

interface RawService {
  d: number[]; // [mon,tue,wed,thu,fri,sat,sun]
  s: number; // start YYYYMMDD
  e: number; // end   YYYYMMDD
}

interface RawTrip {
  r: string; // route name
  c: string; // carrier (Amtrak / FlixBus / Greyhound)
  t: number; // route_type  2=rail, 3=bus
  sv: string; // service_id
  h: string; // headsign
  st: [string, number, number][]; // [stop_id, arrivalMin, departureMin]
}

interface RawSchedule {
  stops: Record<string, RawStop>;
  services: Record<string, RawService>;
  serviceEx: Record<string, Record<string, number>>;
  trips: RawTrip[];
  transfers: Record<string, string[]>; // stop → nearby stops (cross-agency)
}

// ── Public types ──────────────────────────────────────────────────────────

export interface GTFSStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distMi: number; // populated by findNearbyStops
}

export interface GTFSLeg {
  carrier: string;
  routeName: string;
  mode: "bus" | "train";
  fromStopId: string;
  fromStopName: string;
  fromLat: number;
  fromLng: number;
  toStopId: string;
  toStopName: string;
  toLat: number;
  toLng: number;
  departMinutes: number; // minutes from midnight (can exceed 1440)
  arriveMinutes: number;
  durationMinutes: number;
  miles: number;
}

export interface GTFSItinerary {
  legs: GTFSLeg[];
  boardStopId: string; // first boarding stop (for first-mile calc)
  alightStopId: string; // last alighting stop (for last-mile calc)
  departMinutes: number; // earliest departure (at first transit stop)
  arriveMinutes: number; // latest arrival (at last transit stop)
  totalTransitMinutes: number;
}

// ── RAPTOR data structures ──────────────────────────────────────────────

interface RoutePattern {
  stops: string[]; // ordered stop IDs
  tripIndices: number[]; // indices into d.trips, sorted by dep at first stop
}

interface Label {
  arriveMin: number;
  tripIdx: number;
  boardPos: number; // position in pattern where boarded
  alightPos: number; // position in pattern where alighted
  patternIdx: number;
  offset: number; // 0 or -1440 (service day)
  prevLabel: Label | null; // chain for multi-leg reconstruction
  round: number;
}

// ── Singleton loader ──────────────────────────────────────────────────────

let data: RawSchedule | null = null;
let patterns: RoutePattern[] = [];
let stopRoutes: Map<string, { pi: number; pos: number }[]> = new Map();

function load(): RawSchedule {
  if (data) return data;
  const raw = fs.readFileSync(
    path.join(process.cwd(), "data", "gtfs-schedule.json"),
    "utf-8"
  );
  data = JSON.parse(raw) as RawSchedule;

  // ── Build route patterns: group trips by stop sequence ──
  const patternMap = new Map<string, number[]>();
  for (let ti = 0; ti < data.trips.length; ti++) {
    const key = data.trips[ti].st.map((s) => s[0]).join("|");
    if (!patternMap.has(key)) patternMap.set(key, []);
    patternMap.get(key)!.push(ti);
  }

  patterns = [];
  for (const [key, tripIndices] of patternMap) {
    // Sort trips by departure at first stop (ascending)
    tripIndices.sort(
      (a, b) => data!.trips[a].st[0][2] - data!.trips[b].st[0][2]
    );
    patterns.push({ stops: key.split("|"), tripIndices });
  }

  // ── Build stop → patterns index ──
  stopRoutes = new Map();
  for (let pi = 0; pi < patterns.length; pi++) {
    const pat = patterns[pi];
    for (let pos = 0; pos < pat.stops.length; pos++) {
      const sid = pat.stops[pos];
      if (!stopRoutes.has(sid)) stopRoutes.set(sid, []);
      stopRoutes.get(sid)!.push({ pi, pos });
    }
  }

  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function haversineMi(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toR = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Check whether a service_id is active on a given date (YYYYMMDD int). */
function isServiceActive(svcId: string, dateInt: number): boolean {
  const d = load();
  const svc = d.services[svcId];
  if (!svc) return false;
  if (dateInt < svc.s || dateInt > svc.e) return false;

  // Check exceptions first
  const ex = d.serviceEx[svcId];
  if (ex) {
    const exType = ex[String(dateInt)];
    if (exType === 2) return false; // service removed
    if (exType === 1) return true; // service added
  }

  // Day-of-week check (Mon=0 in GTFS d array, JS getDay: Sun=0)
  const y = Math.floor(dateInt / 10000);
  const m = Math.floor((dateInt % 10000) / 100) - 1;
  const day = dateInt % 100;
  const dt = new Date(y, m, day);
  const jsDay = dt.getDay(); // 0=Sun
  const gtfsIdx = jsDay === 0 ? 6 : jsDay - 1; // Mon=0 … Sun=6
  return svc.d[gtfsIdx] === 1;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Find GTFS stops within `radiusMi` of a point, sorted by distance. */
export function findNearbyStops(
  lat: number,
  lng: number,
  radiusMi: number,
  maxResults = 30
): GTFSStop[] {
  const d = load();
  const results: GTFSStop[] = [];
  for (const [id, s] of Object.entries(d.stops)) {
    // Quick bounding-box filter (~1° lat ≈ 69 mi)
    const dlat = Math.abs(s.lat - lat);
    const dlng = Math.abs(s.lng - lng);
    if (dlat > radiusMi / 60 || dlng > radiusMi / 45) continue;
    const dist = haversineMi(lat, lng, s.lat, s.lng);
    if (dist <= radiusMi) {
      results.push({ id, name: s.n, lat: s.lat, lng: s.lng, distMi: dist });
    }
  }
  results.sort((a, b) => a.distMi - b.distMi);
  return results.slice(0, maxResults);
}

// ── Station departures ────────────────────────────────────────────────────

export interface StationDeparture {
  carrier: string;        // "Amtrak" | "FlixBus" | "Greyhound"
  routeName: string;
  headsign: string;
  mode: "bus" | "train";
  departMinutes: number;  // minutes from midnight
  departTime: string;     // "HH:MM AM/PM"
  destination: string;    // last stop name on this trip
}

/**
 * Get upcoming departures from a station on a given date.
 * Matches by lat/lng proximity (< 0.5 mi).
 */
export function getStationDepartures(
  lat: number,
  lng: number,
  dateYMD: string,
): StationDeparture[] {
  const d = load();
  const dateInt = parseInt(dateYMD.replace(/-/g, ""), 10);

  // Find matching GTFS stop(s) within 0.5 mi
  const matchedStops = findNearbyStops(lat, lng, 0.5, 5);
  if (matchedStops.length === 0) return [];

  const stopIds = new Set(matchedStops.map((s) => s.id));
  const departures: StationDeparture[] = [];

  for (const trip of d.trips) {
    if (!isServiceActive(trip.sv, dateInt)) continue;

    for (let i = 0; i < trip.st.length; i++) {
      const [stopId, , depMin] = trip.st[i];
      if (!stopIds.has(stopId)) continue;
      if (depMin < 0) continue;
      // Skip if this is the last stop (no departure from here)
      if (i === trip.st.length - 1) continue;

      const lastStop = d.stops[trip.st[trip.st.length - 1][0]];
      const hrs = Math.floor(depMin / 60) % 24;
      const mins = depMin % 60;
      const ampm = hrs >= 12 ? "PM" : "AM";
      const h12 = hrs === 0 ? 12 : hrs > 12 ? hrs - 12 : hrs;

      departures.push({
        carrier: trip.c,
        routeName: trip.r,
        headsign: trip.h,
        mode: trip.t === 2 ? "train" : "bus",
        departMinutes: depMin,
        departTime: `${h12}:${String(mins).padStart(2, "0")} ${ampm}`,
        destination: lastStop?.n ?? trip.h,
      });
      break; // one departure per trip
    }
  }

  departures.sort((a, b) => a.departMinutes - b.departMinutes);
  return departures;
}

/** Compute YYYYMMDD int for the day before a given YYYYMMDD int. */
function prevDateInt(dateInt: number): number {
  const y = Math.floor(dateInt / 10000);
  const m = Math.floor((dateInt % 10000) / 100) - 1;
  const day = dateInt % 100;
  const dt = new Date(y, m, day);
  dt.setDate(dt.getDate() - 1);
  return (
    dt.getFullYear() * 10000 +
    (dt.getMonth() + 1) * 100 +
    dt.getDate()
  );
}

export type ModeFilter = "all" | "bus" | "train";

// ── RAPTOR journey reconstruction ────────────────────────────────────────

function reconstructJourney(
  label: Label,
  d: RawSchedule
): GTFSItinerary | null {
  // Walk label chain to collect legs in reverse order
  const chain: Label[] = [];
  let cur: Label | null = label;
  while (cur) {
    chain.push(cur);
    cur = cur.prevLabel;
  }
  chain.reverse(); // first leg first

  const legs: GTFSLeg[] = [];
  for (const lab of chain) {
    const trip = d.trips[lab.tripIdx];
    const pat = patterns[lab.patternIdx];
    const fromStopId = pat.stops[lab.boardPos];
    const toStopId = pat.stops[lab.alightPos];
    const fromStop = d.stops[fromStopId];
    const toStop = d.stops[toStopId];
    const departMinutes = trip.st[lab.boardPos][2] + lab.offset;
    const arriveMinutes = trip.st[lab.alightPos][1] + lab.offset;

    legs.push({
      carrier: trip.c,
      routeName: trip.h || trip.r,
      mode: trip.t === 2 ? "train" : "bus",
      fromStopId,
      fromStopName: fromStop.n,
      fromLat: fromStop.lat,
      fromLng: fromStop.lng,
      toStopId,
      toStopName: toStop.n,
      toLat: toStop.lat,
      toLng: toStop.lng,
      departMinutes,
      arriveMinutes,
      durationMinutes: arriveMinutes - departMinutes,
      miles: Math.round(
        haversineMi(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng)
      ),
    });
  }

  if (legs.length === 0) return null;

  return {
    legs,
    boardStopId: legs[0].fromStopId,
    alightStopId: legs[legs.length - 1].toStopId,
    departMinutes: legs[0].departMinutes,
    arriveMinutes: legs[legs.length - 1].arriveMinutes,
    totalTransitMinutes:
      legs[legs.length - 1].arriveMinutes - legs[0].departMinutes,
  };
}

/**
 * Search for bus/train itineraries between two areas on a given date
 * using the RAPTOR (Round-based Public Transit Optimized Router) algorithm.
 *
 * Handles overnight trips: checks trips starting the day before whose
 * stop_times > 1440 (24h) land on the game day.
 *
 * @param modeFilter "all" | "bus" | "train" — filter to only bus or only train trips
 */
export function searchGTFS(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  dateYMD: string,
  deadlineMin: number,
  originRadiusMi = 60,
  destRadiusMi = 40,
  modeFilter: ModeFilter = "all"
): GTFSItinerary[] {
  const d = load();

  const dateInt = parseInt(dateYMD.replace(/-/g, ""), 10);
  const prevDate = prevDateInt(dateInt);

  // Service days to check: [dateInt, offset] pairs
  // offset = minutes to add to stop_times so they're on the game-day timeline
  const serviceDays: { svcDate: number; offset: number }[] = [
    { svcDate: dateInt, offset: 0 },
    { svcDate: prevDate, offset: -1440 },
  ];

  const originStops = findNearbyStops(
    originLat,
    originLng,
    originRadiusMi,
    25
  );
  const destStops = findNearbyStops(destLat, destLng, destRadiusMi, 25);

  if (originStops.length === 0 || destStops.length === 0) return [];

  const destStopSet = new Set(destStops.map((s) => s.id));
  const directDist = haversineMi(originLat, originLng, destLat, destLng);

  // Precompute active trips per service day (with mode filter)
  const wantType = modeFilter === "bus" ? 3 : modeFilter === "train" ? 2 : 0;
  const activeSets: Set<number>[] = serviceDays.map(({ svcDate }) => {
    const active = new Set<number>();
    for (let ti = 0; ti < d.trips.length; ti++) {
      const trip = d.trips[ti];
      if (wantType && trip.t !== wantType) continue;
      if (isServiceActive(trip.sv, svcDate)) active.add(ti);
    }
    return active;
  });

  // ── RAPTOR state ──────────────────────────────────────────────────────

  const TRANSFER_BUFFER = 30; // minutes minimum layover
  const MAX_ROUNDS = 3; // round 1=direct, 2=1-transfer, 3=2-transfer

  // bestArrival[stopId] = earliest known arrival time at this stop
  const bestArrival = new Map<string, number>();
  // labels at each stop for journey reconstruction (only Pareto-best)
  const allLabels = new Map<string, Label[]>();
  // collected destination arrivals (for variety — not just Pareto-best)
  const destArrivals: Label[] = [];

  let markedStops = new Set<string>();

  // Initialize: origin stops are reachable (sentinel = earliest possible time)
  for (const oStop of originStops) {
    bestArrival.set(oStop.id, -1440);
    markedStops.add(oStop.id);
  }

  // ── RAPTOR rounds ─────────────────────────────────────────────────────

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // Build queue: for each marked stop, find patterns and earliest position
    const Q = new Map<number, number>(); // patternIdx → earliest scan position
    for (const sid of markedStops) {
      const routes = stopRoutes.get(sid);
      if (!routes) continue;
      for (const { pi, pos } of routes) {
        const existing = Q.get(pi);
        if (existing === undefined || pos < existing) {
          Q.set(pi, pos);
        }
      }
    }

    const newMarked = new Set<string>();

    // Process each queued pattern
    for (const [pi, startPos] of Q) {
      const pattern = patterns[pi];

      // Try each service day
      for (let sdIdx = 0; sdIdx < serviceDays.length; sdIdx++) {
        const { offset } = serviceDays[sdIdx];
        const activeSet = activeSets[sdIdx];

        // Iterate all active trips in this pattern
        for (const ti of pattern.tripIndices) {
          if (!activeSet.has(ti)) continue;
          const trip = d.trips[ti];

          let boarded = false;
          let boardPos = -1;
          let boardLabel: Label | null = null;

          // Scan positions from startPos to end of pattern
          for (let p = startPos; p < pattern.stops.length; p++) {
            const sid = pattern.stops[p];
            const depAtP = trip.st[p][2] + offset;
            const arrAtP = trip.st[p][1] + offset;

            // Try to board at this position
            if (!boarded) {
              const reachTime = bestArrival.get(sid);
              if (reachTime !== undefined) {
                const minDep =
                  round === 1 ? reachTime : reachTime + TRANSFER_BUFFER;

                if (depAtP >= minDep && depAtP >= -120) {
                  boarded = true;
                  boardPos = p;

                  // Find parent label for reconstruction (round > 1)
                  if (round > 1) {
                    const prevLabels = allLabels.get(sid);
                    if (prevLabels && prevLabels.length > 0) {
                      boardLabel = prevLabels.reduce((best, l) =>
                        l.arriveMin < best.arriveMin ? l : best
                      );
                    }
                  }
                }
              }
              continue; // boarding stop itself isn't a downstream arrival
            }

            // Boarded, check downstream stop
            if (arrAtP > deadlineMin) break; // past deadline
            if (arrAtP < 0) continue; // before game day

            const label: Label = {
              arriveMin: arrAtP,
              tripIdx: ti,
              boardPos,
              alightPos: p,
              patternIdx: pi,
              offset,
              prevLabel: boardLabel,
              round,
            };

            // Collect at destination stops (always, for variety)
            if (destStopSet.has(sid)) {
              destArrivals.push(label);
            }

            // Update bestArrival for RAPTOR pruning
            const currentBest = bestArrival.get(sid);
            if (currentBest === undefined || arrAtP < currentBest) {
              bestArrival.set(sid, arrAtP);
              newMarked.add(sid);

              // Store label for future round reconstruction
              if (!allLabels.has(sid)) allLabels.set(sid, []);
              allLabels.get(sid)!.push(label);
            }
          }
        }
      }
    }

    // ── Footpath transfers ──
    const transferMarked = new Set<string>();
    for (const sid of newMarked) {
      const partners = d.transfers[sid];
      if (!partners) continue;
      const myArrival = bestArrival.get(sid)!;
      for (const partnerId of partners) {
        const partnerBest = bestArrival.get(partnerId);
        if (partnerBest === undefined || myArrival < partnerBest) {
          bestArrival.set(partnerId, myArrival);
          transferMarked.add(partnerId);

          // Propagate labels to transfer partner
          const myLabels = allLabels.get(sid);
          if (myLabels) {
            if (!allLabels.has(partnerId)) allLabels.set(partnerId, []);
            for (const lab of myLabels) {
              allLabels.get(partnerId)!.push(lab);
            }
          }
        }
      }
    }

    markedStops = new Set([...newMarked, ...transferMarked]);
    if (markedStops.size === 0) break; // no improvements, done early
  }

  // ── Reconstruct journeys ──────────────────────────────────────────────

  const results: GTFSItinerary[] = [];
  const seen = new Set<string>();

  for (const label of destArrivals) {
    const itin = reconstructJourney(label, d);
    if (!itin) continue;

    // Dedup by exact leg sequence
    const key = itin.legs
      .map(
        (l) =>
          `${l.fromStopId}:${l.departMinutes}:${l.toStopId}:${l.arriveMinutes}`
      )
      .join("-");
    if (seen.has(key)) continue;
    seen.add(key);

    // Geographic sanity for multi-leg itineraries
    if (itin.legs.length > 1) {
      let sane = true;
      let totalLegMi = 0;
      for (let i = 0; i < itin.legs.length; i++) {
        totalLegMi += itin.legs[i].miles;
        // Transfer points must not be further from dest than origin (20% tolerance)
        if (i < itin.legs.length - 1) {
          const midToDestMi = haversineMi(
            itin.legs[i].toLat,
            itin.legs[i].toLng,
            destLat,
            destLng
          );
          if (midToDestMi > directDist * 1.2) {
            sane = false;
            break;
          }
        }
      }
      if (!sane || totalLegMi > directDist * 2.5) continue;
    }

    results.push(itin);
  }

  // Sort by total transit time (shortest first), then by arrival time
  results.sort(
    (a, b) =>
      a.totalTransitMinutes - b.totalTransitMinutes ||
      a.arriveMinutes - b.arriveMinutes
  );

  // Aggressive deduplication: bucket by rounded departure time (15-min windows)
  // and same number of legs + carriers. Keep only the shortest per bucket.
  const deduped: GTFSItinerary[] = [];
  const dedupKeys = new Set<string>();
  for (const it of results) {
    const depBucket = Math.round(it.departMinutes / 15) * 15;
    const carriers = it.legs.map((l) => l.carrier).join("+");
    const key = `${it.legs.length}|${carriers}|${depBucket}`;
    if (dedupKeys.has(key)) continue;
    dedupKeys.add(key);
    deduped.push(it);
    if (deduped.length >= 50) break; // hard cap
  }

  return deduped;
}
