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
