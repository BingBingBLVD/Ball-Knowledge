import { NextRequest, NextResponse } from "next/server";

export interface PlayerSeasonStats {
  gamesPlayed: number;
  minutesPerGame: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
  turnoversPerGame: number;
  fieldGoalPct: number;
  threePointPct: number;
  freeThrowPct: number;
}

// ── Cache (2 hours) ─────────────────────────────────────────────────────────

const statsCache: Record<string, { data: PlayerSeasonStats; ts: number }> = {};
const STATS_TTL = 2 * 60 * 60 * 1000;

// ESPN stat name → our field name
const STAT_MAP: Record<string, keyof PlayerSeasonStats> = {
  gamesPlayed: "gamesPlayed",
  avgMinutes: "minutesPerGame",
  avgPoints: "pointsPerGame",
  avgRebounds: "reboundsPerGame",
  avgAssists: "assistsPerGame",
  avgSteals: "stealsPerGame",
  avgBlocks: "blocksPerGame",
  avgTurnovers: "turnoversPerGame",
  fieldGoalPct: "fieldGoalPct",
  threePointFieldGoalPct: "threePointPct",
  freeThrowPct: "freeThrowPct",
};

export async function GET(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id parameter required (numeric ESPN athlete ID)" }, { status: 400 });
  }

  const now = Date.now();
  if (statsCache[id] && now - statsCache[id].ts < STATS_TTL) {
    return NextResponse.json({ stats: statsCache[id].data });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(
      `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/stats`,
      { signal: controller.signal, next: { revalidate: 7200 } },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ stats: null });
    }

    const data = await res.json();

    // Find the "averages" category
    const categories: unknown[] = data.categories ?? [];
    const avgCategory = categories.find(
      (c: unknown) => (c as { name?: string }).name === "averages",
    ) as { names?: string[]; statistics?: { stats?: number[] }[] } | undefined;

    if (!avgCategory?.names || !avgCategory.statistics?.length) {
      return NextResponse.json({ stats: null });
    }

    // Latest season is first entry in statistics array
    const latestSeason = avgCategory.statistics[0];
    const values = latestSeason.stats ?? [];
    const names = avgCategory.names;

    const stats: PlayerSeasonStats = {
      gamesPlayed: 0,
      minutesPerGame: 0,
      pointsPerGame: 0,
      reboundsPerGame: 0,
      assistsPerGame: 0,
      stealsPerGame: 0,
      blocksPerGame: 0,
      turnoversPerGame: 0,
      fieldGoalPct: 0,
      threePointPct: 0,
      freeThrowPct: 0,
    };

    // gamesPlayed lives in the "totals" category
    const totalsCategory = categories.find(
      (c: unknown) => (c as { name?: string }).name === "totals",
    ) as { names?: string[]; statistics?: { stats?: number[] }[] } | undefined;
    if (totalsCategory?.names && totalsCategory.statistics?.length) {
      const gpIdx = totalsCategory.names.indexOf("gamesPlayed");
      if (gpIdx !== -1) {
        stats.gamesPlayed = Number(totalsCategory.statistics[0].stats?.[gpIdx]) || 0;
      }
    }

    for (let i = 0; i < names.length; i++) {
      const field = STAT_MAP[names[i]];
      if (field && values[i] !== undefined) {
        const num = Number(values[i]);
        if (!Number.isNaN(num)) {
          (stats as Record<string, number>)[field] = num;
        }
      }
    }

    statsCache[id] = { data: stats, ts: now };
    return NextResponse.json({ stats });
  } catch {
    return NextResponse.json({ stats: null });
  }
}
