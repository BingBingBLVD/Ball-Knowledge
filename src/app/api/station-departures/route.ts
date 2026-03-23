import { NextRequest, NextResponse } from "next/server";
import { getStationDepartures, type StationDeparture } from "@/lib/gtfs";

export interface StationDepartureResult {
  code: string;
  name: string;
  departures: StationDeparture[];
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const stopsRaw = sp.get("stops"); // JSON array of {code, name, lat, lng}
  const date = sp.get("date");

  if (!stopsRaw || !date) {
    return NextResponse.json({ stations: [] });
  }

  let stops: { code: string; name: string; lat: number; lng: number }[];
  try {
    stops = JSON.parse(stopsRaw);
  } catch {
    return NextResponse.json({ stations: [] });
  }

  const stations: StationDepartureResult[] = stops.map((s) => ({
    code: s.code,
    name: s.name,
    departures: getStationDepartures(s.lat, s.lng, date),
  }));

  return NextResponse.json({ stations });
}
