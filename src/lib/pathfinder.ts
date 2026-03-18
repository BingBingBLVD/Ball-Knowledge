export interface Route {
  from: string;
  to: string;
}

export interface Path {
  stops: string[];
  layovers: number;
}

export function getAllCities(routes: Route[]): string[] {
  const cities = new Set<string>();
  for (const r of routes) {
    cities.add(r.from);
    cities.add(r.to);
  }
  return Array.from(cities).sort((a, b) => a.localeCompare(b));
}

export function buildAdjacency(routes: Route[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const r of routes) {
    if (!adj.has(r.from)) adj.set(r.from, []);
    adj.get(r.from)!.push(r.to);
  }
  return adj;
}

export function findPaths(
  adj: Map<string, string[]>,
  from: string,
  to: string,
  maxLayovers: number,
  maxResults = 200
): Path[] {
  const results: Path[] = [];
  if (from === to) return results;

  const queue: string[][] = [[from]];

  while (queue.length > 0 && results.length < maxResults) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    const neighbors = adj.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (path.includes(neighbor)) continue;

      const newPath = [...path, neighbor];

      if (neighbor === to) {
        results.push({ stops: newPath, layovers: newPath.length - 2 });
        if (results.length >= maxResults) break;
      } else {
        if (newPath.length - 1 <= maxLayovers) {
          queue.push(newPath);
        }
      }
    }
  }

  results.sort((a, b) => a.layovers - b.layovers || a.stops.length - b.stops.length);
  return results;
}
