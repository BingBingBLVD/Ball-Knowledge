export interface TeamRecord {
  wins: number;
  losses: number;
}

// ESPN abbreviation → Kalshi abbreviation mapping
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

export interface EspnTicketInfo {
  price: number;
  available: number;
  url: string | null;
}

export interface EspnBroadcastInfo {
  national: string[];   // e.g. ["ESPN", "TNT"]
  local: string[];      // e.g. ["NBC Sports Bay Area", "Bally Sports"]
}

export interface EspnScoreboardData {
  tickets: Record<string, EspnTicketInfo>;
  broadcasts: Record<string, EspnBroadcastInfo>;
}

/**
 * Fetch ticket prices and broadcast info from ESPN scoreboard for a set of dates.
 * Returns maps keyed by "AWAYCODE@HOMECODE" (normalized Kalshi codes).
 */
export async function fetchEspnScoreboard(dates: string[]): Promise<EspnScoreboardData> {
  const tickets: Record<string, EspnTicketInfo> = {};
  const broadcasts: Record<string, EspnBroadcastInfo> = {};
  const uniqueDates = [...new Set(dates)];

  await Promise.all(
    uniqueDates.map(async (date) => {
      try {
        const dateParam = date.replace(/-/g, "");
        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateParam}`,
          { next: { revalidate: 300 } }
        );
        if (!res.ok) return;

        const data = await res.json();
        const events = data.events ?? [];

        for (const ev of events) {
          // Extract team codes from competitions
          const comp = ev.competitions?.[0];
          if (!comp) continue;

          const competitors = comp.competitors ?? [];
          let homeCode: string | null = null;
          let awayCode: string | null = null;
          for (const c of competitors) {
            const abbr = normalizeAbbr(c.team?.abbreviation ?? "");
            if (c.homeAway === "home") homeCode = abbr;
            else if (c.homeAway === "away") awayCode = abbr;
          }

          if (!homeCode || !awayCode) continue;
          const key = `${awayCode}@${homeCode}`;

          // Extract ticket info
          const ticketArr = ev.tickets ?? comp.tickets ?? [];
          if (ticketArr.length > 0) {
            const ticket = ticketArr[0];
            const summary: string = ticket.summary ?? "";
            const priceMatch = summary.match(/\$(\d+)/);
            if (priceMatch) {
              tickets[key] = {
                price: parseInt(priceMatch[1], 10),
                available: ticket.numberAvailable ?? 0,
                url: ticket.links?.[0]?.href ?? null,
              };
            }
          }

          // Extract broadcast info
          const geoBroadcasts = comp.geoBroadcasts ?? [];
          const national: string[] = [];
          const local: string[] = [];
          for (const gb of geoBroadcasts) {
            const name = gb.media?.shortName ?? "";
            if (!name) continue;
            const market = gb.market?.type ?? "";
            if ((market === "National" || market === "Home") && (name === "ESPN" || name === "TNT" || name === "ABC" || name === "NBA TV")) {
              if (!national.includes(name)) national.push(name);
            } else {
              if (!local.includes(name)) local.push(name);
            }
          }
          // Fallback: check top-level broadcasts array
          if (national.length === 0 && local.length === 0) {
            const topBroadcasts = comp.broadcasts ?? [];
            for (const b of topBroadcasts) {
              for (const name of b.names ?? []) {
                if (["ESPN", "TNT", "ABC", "NBA TV"].includes(name)) {
                  if (!national.includes(name)) national.push(name);
                } else {
                  if (!local.includes(name)) local.push(name);
                }
              }
            }
          }
          if (national.length > 0 || local.length > 0) {
            broadcasts[key] = { national, local };
          }
        }
      } catch {
        // skip failed date
      }
    })
  );

  return { tickets, broadcasts };
}

/** @deprecated Use fetchEspnScoreboard instead */
export async function fetchEspnTickets(dates: string[]): Promise<Record<string, EspnTicketInfo>> {
  const data = await fetchEspnScoreboard(dates);
  return data.tickets;
}

export async function fetchNBAStandings(): Promise<Record<string, TeamRecord>> {
  const res = await fetch(
    "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings",
    { next: { revalidate: 3600 } }
  );

  if (!res.ok) return {};

  const data = await res.json();
  const records: Record<string, TeamRecord> = {};

  // ESPN response: { children: [{ standings: { entries: [...] } }] }
  const conferences = data.children ?? [];
  for (const conf of conferences) {
    const entries = conf.standings?.entries ?? [];
    for (const entry of entries) {
      const abbr = entry.team?.abbreviation;
      if (!abbr) continue;

      const stats = entry.stats ?? [];
      let wins = 0;
      let losses = 0;
      for (const stat of stats) {
        if (stat.name === "wins") wins = stat.value;
        if (stat.name === "losses") losses = stat.value;
      }

      records[normalizeAbbr(abbr)] = { wins, losses };
    }
  }

  return records;
}
