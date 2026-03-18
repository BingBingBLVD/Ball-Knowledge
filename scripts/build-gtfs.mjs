#!/usr/bin/env node
/**
 * Build a compact JSON schedule from Amtrak + FlixBus/Greyhound GTFS feeds.
 *
 * Usage:
 *   node scripts/build-gtfs.mjs            # process existing data
 *   node scripts/build-gtfs.mjs --download  # download fresh + process
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const GTFS_DIR = join(DATA_DIR, "gtfs");
const OUT_FILE = join(DATA_DIR, "gtfs-schedule.json");

const FEEDS = [
  {
    id: "amtrak",
    url: "https://content.amtrak.com/content/gtfs/GTFS.zip",
    prefix: "a",
    defaultCarrier: "Amtrak",
  },
  {
    id: "flixbus",
    url: "http://gtfs.gis.flix.tech/gtfs_generic_us.zip",
    prefix: "f",
    defaultCarrier: "FlixBus",
  },
];

// ── CSV parser (handles quoted fields) ────────────────────────────────────

function parseLine(line) {
  const fields = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseCSV(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

function parseTime(str) {
  if (!str) return 0;
  const p = str.split(":");
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

function haversineMi(lat1, lng1, lat2, lng2) {
  const toR = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Download ──────────────────────────────────────────────────────────────

function download() {
  for (const feed of FEEDS) {
    const dir = join(GTFS_DIR, feed.id);
    mkdirSync(dir, { recursive: true });
    console.log(`Downloading ${feed.id} from ${feed.url} ...`);
    execSync(`curl -sL "${feed.url}" -o gtfs.zip && unzip -o gtfs.zip`, {
      cwd: dir,
      stdio: "inherit",
    });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const doDownload = process.argv.includes("--download");
  if (doDownload) download();

  console.log("Building GTFS schedule …");

  const stops = {};
  const services = {};
  const serviceEx = {};
  const trips = [];
  const routeMeta = {};

  for (const feed of FEEDS) {
    const dir = join(GTFS_DIR, feed.id);
    if (!existsSync(join(dir, "stops.txt"))) {
      console.warn(`  ⚠ ${feed.id} not found at ${dir}, skipping`);
      continue;
    }
    console.log(`  Processing ${feed.id} …`);

    // Stops
    const rawStops = parseCSV(readFileSync(join(dir, "stops.txt"), "utf-8"));
    let stopCount = 0;
    for (const s of rawStops) {
      const lat = parseFloat(s.stop_lat);
      const lng = parseFloat(s.stop_lon);
      if (isNaN(lat) || isNaN(lng)) continue;
      stops[`${feed.prefix}:${s.stop_id}`] = {
        n: s.stop_name,
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
      };
      stopCount++;
    }

    // Routes
    const rawRoutes = parseCSV(readFileSync(join(dir, "routes.txt"), "utf-8"));
    for (const r of rawRoutes) {
      const carrier =
        feed.id === "flixbus"
          ? r.agency_id?.includes("GREYHOUND")
            ? "Greyhound"
            : "FlixBus"
          : feed.defaultCarrier;
      routeMeta[`${feed.prefix}:${r.route_id}`] = {
        name: r.route_long_name || r.route_short_name || r.route_id,
        type: parseInt(r.route_type) || 3,
        carrier,
      };
    }

    // Calendar
    const rawCal = parseCSV(readFileSync(join(dir, "calendar.txt"), "utf-8"));
    for (const c of rawCal) {
      services[`${feed.prefix}:${c.service_id}`] = {
        d: [
          +c.monday,
          +c.tuesday,
          +c.wednesday,
          +c.thursday,
          +c.friday,
          +c.saturday,
          +c.sunday,
        ],
        s: parseInt(c.start_date),
        e: parseInt(c.end_date),
      };
    }

    // Calendar dates (exceptions)
    const calDatesPath = join(dir, "calendar_dates.txt");
    if (existsSync(calDatesPath)) {
      const rawCD = parseCSV(readFileSync(calDatesPath, "utf-8"));
      for (const cd of rawCD) {
        const key = `${feed.prefix}:${cd.service_id}`;
        if (!serviceEx[key]) serviceEx[key] = {};
        serviceEx[key][cd.date] = parseInt(cd.exception_type);
      }
    }

    // Trips + stop_times
    const rawTrips = parseCSV(readFileSync(join(dir, "trips.txt"), "utf-8"));
    const tripMap = {};
    for (const t of rawTrips) {
      const rm = routeMeta[`${feed.prefix}:${t.route_id}`] || {
        name: t.route_id,
        type: 3,
        carrier: feed.defaultCarrier,
      };
      tripMap[t.trip_id] = {
        r: rm.name,
        c: rm.carrier,
        t: rm.type,
        sv: `${feed.prefix}:${t.service_id}`,
        h: t.trip_headsign || "",
        st: [],
      };
    }

    const rawST = parseCSV(
      readFileSync(join(dir, "stop_times.txt"), "utf-8")
    );
    for (const st of rawST) {
      const trip = tripMap[st.trip_id];
      if (!trip) continue;
      trip.st.push([
        `${feed.prefix}:${st.stop_id}`,
        parseTime(st.arrival_time),
        parseTime(st.departure_time),
        parseInt(st.stop_sequence) || trip.st.length + 1,
      ]);
    }

    // Sort stop_times by sequence, drop sequence field, push to allTrips
    let tripCount = 0;
    for (const [tid, trip] of Object.entries(tripMap)) {
      trip.st.sort((a, b) => a[3] - b[3]);
      trip.st = trip.st.map(([id, arr, dep]) => [id, arr, dep]);
      if (trip.st.length >= 2) {
        trips.push(trip);
        tripCount++;
      }
    }
    console.log(`    ${stopCount} stops, ${tripCount} trips`);
  }

  // ── Compute transfer clusters (stops within 5 mi of each other) ───────

  console.log("  Computing transfer map …");
  const TRANSFER_MI = 5;
  const stopIds = Object.keys(stops);
  const transfers = {};

  // Sort stops by lat for faster neighbor search
  const sortedByLat = stopIds
    .map((id) => ({ id, lat: stops[id].lat, lng: stops[id].lng }))
    .sort((a, b) => a.lat - b.lat);

  for (let i = 0; i < sortedByLat.length; i++) {
    const a = sortedByLat[i];
    const nearby = [];
    // Only check neighbors within ~0.08 deg latitude (≈5.5 mi)
    for (let j = i + 1; j < sortedByLat.length; j++) {
      const b = sortedByLat[j];
      if (b.lat - a.lat > 0.08) break;
      if (Math.abs(a.lng - b.lng) > 0.1) continue;
      if (a.id === b.id) continue;
      // Different provider prefix → check distance
      if (a.id[0] !== b.id[0]) {
        if (haversineMi(a.lat, a.lng, b.lat, b.lng) <= TRANSFER_MI) {
          nearby.push(b.id);
          if (!transfers[b.id]) transfers[b.id] = [];
          transfers[b.id].push(a.id);
        }
      }
    }
    if (nearby.length > 0) {
      if (!transfers[a.id]) transfers[a.id] = [];
      transfers[a.id].push(...nearby);
    }
  }

  // Also add same-stop transfers (same stop_id used by multiple trips is
  // inherently a transfer point — handled by the query engine via stopIndex)

  // ── Write output ──────────────────────────────────────────────────────

  const output = {
    meta: {
      built: new Date().toISOString(),
      stops: stopIds.length,
      trips: trips.length,
      services: Object.keys(services).length,
      transferStops: Object.keys(transfers).length,
    },
    stops,
    services,
    serviceEx,
    trips,
    transfers,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output));
  const mb = (readFileSync(OUT_FILE).length / 1048576).toFixed(1);
  console.log(
    `\nDone → ${OUT_FILE} (${mb} MB)\n` +
      `  ${stopIds.length} stops · ${trips.length} trips · ` +
      `${Object.keys(transfers).length} transfer stops`
  );
}

main();
