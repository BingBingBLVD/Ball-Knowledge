import { NextRequest, NextResponse } from "next/server";
import { getTravelTimes } from "@/lib/driving";

/**
 * POST /api/enrich-itinerary
 *
 * Takes an array of enrichable legs (drive/rideshare segments) and returns
 * real Google Maps data for each, plus local transit alternatives.
 *
 * Body: { legs: [{ fromLat, fromLng, toLat, toLng }] }
 * Response: { legs: [{ driveMinutes, transitMinutes, transitFare, uberEstimate, lyftEstimate }] }
 */

interface EnrichRequest {
  legs: {
    fromLat: number;
    fromLng: number;
    toLat: number;
    toLng: number;
  }[];
}

export async function POST(req: NextRequest) {
  try {
    const body: EnrichRequest = await req.json();
    if (!body.legs || !Array.isArray(body.legs)) {
      return NextResponse.json(
        { error: "Missing legs array" },
        { status: 400 }
      );
    }

    // Cap at 10 legs per request to avoid abuse
    const legs = body.legs.slice(0, 10);

    const results = await Promise.all(
      legs.map(async (leg) => {
        if (
          [leg.fromLat, leg.fromLng, leg.toLat, leg.toLng].some(
            (v) => v == null || isNaN(v)
          )
        ) {
          return null;
        }
        const times = await getTravelTimes(
          leg.fromLat,
          leg.fromLng,
          leg.toLat,
          leg.toLng
        );
        return {
          driveMinutes: times.driveMinutes,
          transitMinutes: times.transitMinutes,
          transitFare: times.transitFare, // only if Google returns it
          uberEstimate: times.uberEstimate,
          lyftEstimate: times.lyftEstimate,
        };
      })
    );

    return NextResponse.json({ legs: results });
  } catch (err) {
    console.error("[enrich-itinerary] Error:", err);
    return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
  }
}
