const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Run an Overpass QL query with automatic retry across mirror servers */
export async function queryOverpass(query: string): Promise<{ elements: any[] }> {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        lastError = new Error(`Overpass ${res.status}`);
        continue;
      }
      const text = await res.text();
      // Overpass returns HTML error pages on failure
      if (text.startsWith("<?xml") || text.startsWith("<!DOCTYPE")) {
        lastError = new Error("Overpass returned HTML error");
        continue;
      }
      const data = JSON.parse(text);
      if (data.elements) return data;
      lastError = new Error("No elements in response");
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error("All Overpass endpoints failed");
}
