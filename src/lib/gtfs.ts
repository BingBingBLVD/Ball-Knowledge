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

// ── Singleton loader ──────────────────────────────────────────────────────

let data: RawSchedule | null = null;
let stopIndex: Map<string, { ti: number; si: number }[]> | null = null;

function load(): RawSchedule {
  if (data) return data;
  const raw = fs.readFileSync(
    path.join(process.cwd(), "data", "gtfs-schedule.json"),
    "utf-8"
  );
  data = JSON.parse(raw) as RawSchedule;

  // Build stop → trip index
  stopIndex = new Map();
  for (let ti = 0; ti < data.trips.length; ti++) {
    const trip = data.trips[ti];
    for (let si = 0; si < trip.st.length; si++) {
      const sid = trip.st[si][0];
      if (!stopIndex.has(sid)) stopIndex.set(sid, []);
      stopIndex.get(sid)!.push({ ti, si });
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

/**
 * Search for bus/train itineraries between two areas on a given date.
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
  const si = stopIndex!;

  const dateInt = parseInt(dateYMD.replace(/-/g, ""), 10);
  const prevDate = prevDateInt(dateInt);

  // Service days to check: [dateInt, offset] pairs
  // offset = minutes to add to stop_times so they're on the game-day timeline
  // - Same-day trips: offset = 0 (stop_times 0–1440 are on game day)
  // - Previous-day trips: offset = -1440 (stop_times 1440–2880 map to game-day 0–1440)
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
  const results: GTFSItinerary[] = [];

  // Check which trips are active for each service day (filtered by mode)
  const wantType = modeFilter === "bus" ? 3 : modeFilter === "train" ? 2 : 0;
  const activeTripSets = new Map<number, Set<number>>(); // svcDate → set of trip indices
  for (const { svcDate } of serviceDays) {
    const active = new Set<number>();
    for (let ti = 0; ti < d.trips.length; ti++) {
      const trip = d.trips[ti];
      if (wantType && trip.t !== wantType) continue; // mode filter
      if (isServiceActive(trip.sv, svcDate)) {
        active.add(ti);
      }
    }
    activeTripSets.set(svcDate, active);
  }

  // ── Direct trips ────────────────────────────────────────────────────

  for (const oStop of originStops) {
    const entries = si.get(oStop.id);
    if (!entries) continue;

    for (const { ti, si: boardIdx } of entries) {
      const trip = d.trips[ti];

      for (const { svcDate, offset } of serviceDays) {
        if (!activeTripSets.get(svcDate)!.has(ti)) continue;

        const boardDep = trip.st[boardIdx][2] + offset; // game-day minutes
        if (boardDep < -120) continue; // way too early (previous day)

        // Check subsequent stops for a dest match
        for (let ai = boardIdx + 1; ai < trip.st.length; ai++) {
          const alightStopId = trip.st[ai][0];
          if (!destStopSet.has(alightStopId)) continue;

          const alightArr = trip.st[ai][1] + offset; // game-day minutes
          if (alightArr > deadlineMin) continue; // too late
          if (alightArr < 0) continue; // arrives before game day

          const oStopData = d.stops[oStop.id];
          const dStopData = d.stops[alightStopId];
          const miles = haversineMi(
            oStopData.lat,
            oStopData.lng,
            dStopData.lat,
            dStopData.lng
          );

          results.push({
            legs: [
              {
                carrier: trip.c,
                routeName: trip.h || trip.r,
                mode: trip.t === 2 ? "train" : "bus",
                fromStopId: oStop.id,
                fromStopName: oStopData.n,
                fromLat: oStopData.lat,
                fromLng: oStopData.lng,
                toStopId: alightStopId,
                toStopName: dStopData.n,
                toLat: dStopData.lat,
                toLng: dStopData.lng,
                departMinutes: boardDep,
                arriveMinutes: alightArr,
                durationMinutes: alightArr - boardDep,
                miles: Math.round(miles),
              },
            ],
            boardStopId: oStop.id,
            alightStopId,
            departMinutes: boardDep,
            arriveMinutes: alightArr,
            totalTransitMinutes: alightArr - boardDep,
          });
          break; // take earliest dest stop on this trip
        }
      }
    }
  }

  // ── 1-transfer trips ────────────────────────────────────────────────

  // Phase 1: forward reachability from origin stops
  const forwardReach = new Map<
    string,
    { ti: number; boardIdx: number; alightIdx: number; arriveMin: number; boardStopId: string; offset: number }[]
  >();

  for (const oStop of originStops) {
    const entries = si.get(oStop.id);
    if (!entries) continue;

    for (const { ti, si: boardIdx } of entries) {
      const trip = d.trips[ti];

      for (const { svcDate, offset } of serviceDays) {
        if (!activeTripSets.get(svcDate)!.has(ti)) continue;

        for (let ai = boardIdx + 1; ai < trip.st.length; ai++) {
          const midStopId = trip.st[ai][0];
          const arriveMin = trip.st[ai][1] + offset;
          // Need time for transfer + 2nd leg before deadline
          if (arriveMin > deadlineMin - 30) continue;
          if (arriveMin < -120) continue;

          if (!forwardReach.has(midStopId))
            forwardReach.set(midStopId, []);
          forwardReach.get(midStopId)!.push({
            ti,
            boardIdx,
            alightIdx: ai,
            arriveMin,
            boardStopId: oStop.id,
            offset,
          });
        }
      }
    }
  }

  // Phase 2: backward reachability from dest stops
  const backwardReach = new Map<
    string,
    { ti: number; boardIdx: number; alightIdx: number; departMin: number; arriveMin: number; alightStopId: string; offset: number }[]
  >();

  for (const dStop of destStops) {
    const entries = si.get(dStop.id);
    if (!entries) continue;

    for (const { ti, si: alightIdx } of entries) {
      const trip = d.trips[ti];

      for (const { svcDate, offset } of serviceDays) {
        if (!activeTripSets.get(svcDate)!.has(ti)) continue;

        const alightArr = trip.st[alightIdx][1] + offset;
        if (alightArr > deadlineMin) continue;
        if (alightArr < 0) continue;

        for (let bi = 0; bi < alightIdx; bi++) {
          const midStopId = trip.st[bi][0];
          const departMin = trip.st[bi][2] + offset;

          if (!backwardReach.has(midStopId))
            backwardReach.set(midStopId, []);
          backwardReach.get(midStopId)!.push({
            ti,
            boardIdx: bi,
            alightIdx,
            departMin,
            arriveMin: alightArr,
            alightStopId: dStop.id,
            offset,
          });
        }
      }
    }
  }

  // Phase 3: match forward → backward at transfer points
  const TRANSFER_BUFFER = 30; // minutes minimum layover
  const seen = new Set<string>();
  const directDist = haversineMi(originLat, originLng, destLat, destLng);

  for (const [midStop, fwdList] of forwardReach) {
    const candidateStops = [midStop, ...(d.transfers[midStop] ?? [])];

    for (const candStop of candidateStops) {
      const bwdList = backwardReach.get(candStop);
      if (!bwdList) continue;

      for (const fwd of fwdList) {
        for (const bwd of bwdList) {
          if (fwd.ti === bwd.ti) continue;
          if (fwd.arriveMin + TRANSFER_BUFFER > bwd.departMin) continue;
          if (bwd.arriveMin > deadlineMin) continue;

          // Geographic sanity: prevent backtracking itineraries
          const midGeo = d.stops[midStop];
          const midToDestMi = haversineMi(midGeo.lat, midGeo.lng, destLat, destLng);
          // Transfer point must not be further from dest than origin (20% tolerance for hubs)
          if (midToDestMi > directDist * 1.2) continue;
          // Total leg distance must not exceed 2.5× direct distance
          const fwdFrom = d.stops[fwd.boardStopId];
          const bwdTo = d.stops[bwd.alightStopId];
          const leg1Mi = haversineMi(fwdFrom.lat, fwdFrom.lng, midGeo.lat, midGeo.lng);
          const candGeo = d.stops[candStop];
          const leg2Mi = haversineMi(candGeo.lat, candGeo.lng, bwdTo.lat, bwdTo.lng);
          if (leg1Mi + leg2Mi > directDist * 2.5) continue;

          const key = `${fwd.ti}:${fwd.boardIdx}:${fwd.offset}-${bwd.ti}:${bwd.alightIdx}:${bwd.offset}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const trip1 = d.trips[fwd.ti];
          const trip2 = d.trips[bwd.ti];
          const leg1From = d.stops[trip1.st[fwd.boardIdx][0]];
          const leg1To = d.stops[midStop];
          const leg2From = d.stops[candStop];
          const leg2To = d.stops[trip2.st[bwd.alightIdx][0]];

          const leg1Dep = trip1.st[fwd.boardIdx][2] + fwd.offset;
          const leg1Arr = fwd.arriveMin;
          const leg2Dep = bwd.departMin;
          const leg2Arr = bwd.arriveMin;

          results.push({
            legs: [
              {
                carrier: trip1.c,
                routeName: trip1.h || trip1.r,
                mode: trip1.t === 2 ? "train" : "bus",
                fromStopId: fwd.boardStopId,
                fromStopName: leg1From.n,
                fromLat: leg1From.lat,
                fromLng: leg1From.lng,
                toStopId: midStop,
                toStopName: leg1To.n,
                toLat: leg1To.lat,
                toLng: leg1To.lng,
                departMinutes: leg1Dep,
                arriveMinutes: leg1Arr,
                durationMinutes: leg1Arr - leg1Dep,
                miles: Math.round(
                  haversineMi(
                    leg1From.lat,
                    leg1From.lng,
                    leg1To.lat,
                    leg1To.lng
                  )
                ),
              },
              {
                carrier: trip2.c,
                routeName: trip2.h || trip2.r,
                mode: trip2.t === 2 ? "train" : "bus",
                fromStopId: candStop,
                fromStopName: leg2From.n,
                fromLat: leg2From.lat,
                fromLng: leg2From.lng,
                toStopId: bwd.alightStopId,
                toStopName: leg2To.n,
                toLat: leg2To.lat,
                toLng: leg2To.lng,
                departMinutes: leg2Dep,
                arriveMinutes: leg2Arr,
                durationMinutes: leg2Arr - leg2Dep,
                miles: Math.round(
                  haversineMi(
                    leg2From.lat,
                    leg2From.lng,
                    leg2To.lat,
                    leg2To.lng
                  )
                ),
              },
            ],
            boardStopId: fwd.boardStopId,
            alightStopId: bwd.alightStopId,
            departMinutes: leg1Dep,
            arriveMinutes: leg2Arr,
            totalTransitMinutes: leg2Arr - leg1Dep,
          });
        }
      }
    }
  }

  // Sort by total transit time (shortest first), then by arrival time
  results.sort(
    (a, b) =>
      a.totalTransitMinutes - b.totalTransitMinutes ||
      a.arriveMinutes - b.arriveMinutes
  );

  // Aggressive deduplication: bucket by rounded departure time (30-min windows)
  // and same number of legs. Keep only the shortest per bucket.
  const deduped: GTFSItinerary[] = [];
  const dedupKeys = new Set<string>();
  for (const it of results) {
    // Round departure to nearest 15 min
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
