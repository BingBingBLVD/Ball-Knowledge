import { NextRequest, NextResponse } from "next/server";

export interface PlayerAvailability {
  name: string;
  position: string;
  jersey: string;
  status: "Playing" | "Out" | "Doubtful" | "Questionable" | "Day-To-Day";
  injuryNote?: string;
  headshot?: string;
  espnId?: string;
}

export interface TeamAvailability {
  team: string;
  teamAbbr: string;
  playing: PlayerAvailability[];
  out: PlayerAvailability[];
  gameTime: PlayerAvailability[]; // Questionable, Doubtful, Day-To-Day
}

// Kalshi abbreviation → ESPN abbreviation
const KALSHI_TO_ESPN: Record<string, string> = {
  GSW: "GS",
  SAS: "SA",
  NOP: "NO",
  NYK: "NY",
  WAS: "WSH",
  UTA: "UTAH",
  PHX: "PHO",
};

// ESPN abbreviation → Kalshi abbreviation
const ESPN_TO_KALSHI: Record<string, string> = {
  GS: "GSW",
  SA: "SAS",
  NO: "NOP",
  NY: "NYK",
  WSH: "WAS",
  UTAH: "UTA",
  PHO: "PHX",
};

// ESPN abbreviation → ESPN team numeric ID
const ESPN_TEAM_IDS: Record<string, number> = {
  ATL: 1, BOS: 2, BKN: 17, CHA: 30, CHI: 4, CLE: 5, DAL: 6, DEN: 7, DET: 8,
  GS: 9, HOU: 10, IND: 11, LAC: 12, LAL: 13, MEM: 29, MIA: 14, MIL: 15, MIN: 16,
  NO: 3, NY: 18, OKC: 25, ORL: 19, PHI: 20, PHO: 21, POR: 22, SAC: 23,
  SA: 24, TOR: 28, UTAH: 26, WSH: 27,
};

function kalshiToEspn(kalshi: string): string {
  return KALSHI_TO_ESPN[kalshi.toUpperCase()] ?? kalshi.toUpperCase();
}

function espnToKalshi(espn: string): string {
  const upper = espn.toUpperCase();
  return ESPN_TO_KALSHI[upper] ?? upper;
}

// ── Roster cache (1 hour) ────────────────────────────────────────────────────

interface RosterPlayer {
  name: string;
  position: string;
  jersey: string;
  headshot?: string;
  espnId?: string;
}

const rosterCache: Record<string, { data: RosterPlayer[]; teamName: string; ts: number }> = {};
const ROSTER_TTL = 60 * 60 * 1000;

async function fetchRoster(espnTeamId: number): Promise<{ players: RosterPlayer[]; teamName: string }> {
  const key = String(espnTeamId);
  const now = Date.now();
  if (rosterCache[key] && now - rosterCache[key].ts < ROSTER_TTL) {
    return { players: rosterCache[key].data, teamName: rosterCache[key].teamName };
  }

  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnTeamId}/roster`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) {
    const cached = rosterCache[key];
    return { players: cached?.data ?? [], teamName: cached?.teamName ?? "" };
  }

  const data = await res.json();
  const teamName = data.team?.displayName ?? data.team?.name ?? "";
  const athletes = data.athletes ?? [];
  const players: RosterPlayer[] = [];

  for (const athlete of athletes) {
    const name = athlete.displayName ?? athlete.fullName ?? "";
    if (!name) continue;
    players.push({
      name,
      position: athlete.position?.abbreviation ?? "",
      jersey: athlete.jersey ?? "",
      headshot: athlete.headshot?.href ?? undefined,
      espnId: athlete.id ? String(athlete.id) : undefined,
    });
  }

  rosterCache[key] = { data: players, teamName, ts: now };
  return { players, teamName };
}

// ── Injury cache (10 minutes) ────────────────────────────────────────────────

interface InjuryRecord {
  name: string;
  team: string;
  teamAbbr: string;
  status: string;
  description: string;
}

let injuryCache: InjuryRecord[] | null = null;
let injuryCacheTs = 0;
const INJURY_TTL = 10 * 60 * 1000;

async function fetchAllInjuries(): Promise<InjuryRecord[]> {
  const now = Date.now();
  if (injuryCache && now - injuryCacheTs < INJURY_TTL) return injuryCache;

  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
    { next: { revalidate: 600 } },
  );
  if (!res.ok) return injuryCache ?? [];

  const data = await res.json();
  const injuries: InjuryRecord[] = [];
  const teamGroups = data.injuries ?? [];

  for (const group of teamGroups) {
    const groupName = group.displayName ?? "";
    for (const inj of group.injuries ?? []) {
      const athlete = inj.athlete ?? {};
      const name = athlete.displayName ?? athlete.fullName ?? "";
      const teamName = athlete.team?.displayName ?? groupName;
      const teamAbbr = espnToKalshi(athlete.team?.abbreviation ?? "");
      // fantasyStatus is more reliable: GTD = game-time decision, OUT = out, OFS = out for season
      const fantasyAbbr = inj.details?.fantasyStatus?.abbreviation ?? "";
      const rawStatus = inj.status ?? inj.type ?? "Unknown";
      const status = fantasyAbbr === "GTD" ? "Day-To-Day"
        : fantasyAbbr === "OFS" ? "Out"
        : fantasyAbbr === "OUT" ? "Out"
        : rawStatus;
      const desc = inj.details?.detail ?? inj.longComment ?? inj.shortComment ?? inj.description ?? "";
      if (name) {
        injuries.push({ name, team: teamName, teamAbbr, status, description: desc });
      }
    }
  }

  injuryCache = injuries;
  injuryCacheTs = now;
  return injuries;
}

// ── GET handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const teams = searchParams.get("teams");
  if (!teams) {
    return NextResponse.json({ error: "teams parameter required" }, { status: 400 });
  }

  const kalshiCodes = teams.split(",").map((t) => t.trim().toUpperCase());

  try {
    const allInjuries = await fetchAllInjuries();

    const availability: TeamAvailability[] = await Promise.all(
      kalshiCodes.map(async (kalshi) => {
        const espn = kalshiToEspn(kalshi);
        const teamId = ESPN_TEAM_IDS[espn];

        // Injuries for this team
        const teamInjuries = allInjuries.filter((i) => i.teamAbbr === kalshi);
        const injuredNames = new Set(teamInjuries.map((i) => i.name.toLowerCase()));

        // If we can't resolve the team ID, fall back to injury-only data
        if (!teamId) {
          const out: PlayerAvailability[] = [];
          const gameTime: PlayerAvailability[] = [];
          for (const inj of teamInjuries) {
            const entry: PlayerAvailability = {
              name: inj.name,
              position: "",
              jersey: "",
              status: inj.status === "Out" ? "Out" : (inj.status as PlayerAvailability["status"]),
              injuryNote: inj.description,
            };
            if (inj.status === "Out") out.push(entry);
            else gameTime.push(entry);
          }
          return { team: teamInjuries[0]?.team ?? kalshi, teamAbbr: kalshi, playing: [], out, gameTime };
        }

        const { players: roster, teamName } = await fetchRoster(teamId);

        const playing: PlayerAvailability[] = [];
        const out: PlayerAvailability[] = [];
        const gameTime: PlayerAvailability[] = [];

        for (const p of roster) {
          const injury = teamInjuries.find((i) => i.name.toLowerCase() === p.name.toLowerCase());
          if (injury) {
            const entry: PlayerAvailability = {
              name: p.name,
              position: p.position,
              jersey: p.jersey,
              status: injury.status === "Out" ? "Out" : (injury.status as PlayerAvailability["status"]),
              injuryNote: injury.description,
              headshot: p.headshot,
              espnId: p.espnId,
            };
            if (injury.status === "Out") out.push(entry);
            else gameTime.push(entry);
          } else {
            playing.push({
              name: p.name,
              position: p.position,
              jersey: p.jersey,
              status: "Playing",
              headshot: p.headshot,
              espnId: p.espnId,
            });
          }
        }

        // Add any injured players not found on the roster (two-way contracts, etc.)
        for (const inj of teamInjuries) {
          if (!roster.some((r) => r.name.toLowerCase() === inj.name.toLowerCase())) {
            const entry: PlayerAvailability = {
              name: inj.name,
              position: "",
              jersey: "",
              status: inj.status === "Out" ? "Out" : (inj.status as PlayerAvailability["status"]),
              injuryNote: inj.description,
            };
            if (inj.status === "Out") out.push(entry);
            else gameTime.push(entry);
          }
        }

        return {
          team: teamName || teamInjuries[0]?.team || kalshi,
          teamAbbr: kalshi,
          playing,
          out,
          gameTime,
        };
      }),
    );

    return NextResponse.json({ availability });
  } catch (error) {
    console.error("Failed to fetch availability:", error);
    return NextResponse.json({ availability: [] });
  }
}
