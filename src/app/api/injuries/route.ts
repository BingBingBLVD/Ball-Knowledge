import { NextRequest, NextResponse } from "next/server";

export interface PlayerInjury {
  name: string;
  position: string;
  team: string;
  teamAbbr: string;
  status: string;       // "Out", "Day-To-Day", "Questionable", "Doubtful", "Probable"
  description: string;  // e.g. "Knee" or "Ankle sprain"
}

// ESPN abbreviation → Kalshi abbreviation mapping (same as espn.ts)
const ESPN_TO_KALSHI: Record<string, string> = {
  GS: "GSW",
  SA: "SAS",
  NO: "NOP",
  NY: "NYK",
  WSH: "WAS",
  UTAH: "UTA",
  PHO: "PHX",
};

function normalizeAbbr(espnAbbr: string): string {
  const upper = espnAbbr.toUpperCase();
  return ESPN_TO_KALSHI[upper] ?? upper;
}

// Cache injuries for 10 minutes
let cachedInjuries: PlayerInjury[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000;

async function fetchAllInjuries(): Promise<PlayerInjury[]> {
  const now = Date.now();
  if (cachedInjuries && now - cacheTimestamp < CACHE_TTL) return cachedInjuries;

  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
    { next: { revalidate: 600 } }
  );
  if (!res.ok) return cachedInjuries ?? [];

  const data = await res.json();
  const injuries: PlayerInjury[] = [];

  // ESPN injuries response: { injuries: [{ team: {...}, injuries: [{ athlete: {...}, type, status, ... }] }] }
  // OR it might be: { athletes: [...] } depending on the endpoint version
  const teamGroups = data.injuries ?? [];
  for (const group of teamGroups) {
    const teamName = group.team?.displayName ?? group.team?.name ?? "";
    const teamAbbr = normalizeAbbr(group.team?.abbreviation ?? "");
    const playerInjuries = group.injuries ?? [];
    for (const inj of playerInjuries) {
      const athlete = inj.athlete ?? {};
      const name = athlete.displayName ?? athlete.fullName ?? "";
      const position = athlete.position?.abbreviation ?? "";
      const status = inj.status ?? inj.type ?? "Unknown";
      const desc = inj.details?.detail ?? inj.longComment ?? inj.shortComment ?? inj.description ?? "";
      if (name) {
        injuries.push({
          name,
          position,
          team: teamName,
          teamAbbr,
          status,
          description: desc,
        });
      }
    }
  }

  cachedInjuries = injuries;
  cacheTimestamp = now;
  return injuries;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const teams = searchParams.get("teams"); // comma-separated team abbrs, e.g. "GSW,LAL"
  if (!teams) {
    return NextResponse.json({ error: "teams parameter required" }, { status: 400 });
  }

  const teamCodes = teams.split(",").map((t) => t.trim().toUpperCase());

  try {
    const all = await fetchAllInjuries();
    const filtered = all.filter((inj) => teamCodes.includes(inj.teamAbbr));

    // Sort: Out first, then Day-To-Day/Doubtful/Questionable, then Probable
    const statusOrder: Record<string, number> = { Out: 0, Doubtful: 1, "Day-To-Day": 2, Questionable: 3, Probable: 4 };
    filtered.sort((a, b) => {
      const oa = statusOrder[a.status] ?? 3;
      const ob = statusOrder[b.status] ?? 3;
      return oa - ob;
    });

    return NextResponse.json({ injuries: filtered });
  } catch (error) {
    console.error("Failed to fetch injuries:", error);
    return NextResponse.json({ injuries: [] });
  }
}
