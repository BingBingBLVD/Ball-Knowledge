import { NextRequest, NextResponse } from "next/server";

// Venue photos previously used Google Places Photos API.
// No free OSM equivalent exists — return empty array.
// Could be extended with Wikimedia Commons in the future.

export async function GET(_req: NextRequest) {
  return NextResponse.json({ photos: [] });
}
