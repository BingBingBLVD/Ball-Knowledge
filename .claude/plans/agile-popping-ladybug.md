# Plan: Dynamic Stadium Bag Policies

## Context
Users need to know what they can/can't bring into NBA arenas. Instead of a static data file, we'll dynamically search for and parse each venue's bag policy at runtime (cached), using web search + AI extraction.

## Approach

### 1. Install Anthropic SDK + add API key
- `npm install @anthropic-ai/sdk`
- Add `ANTHROPIC_API_KEY` to `.env.local`
- Claude will parse raw HTML into structured policy data

### 2. New API route: `/api/venue-policy/route.ts`
Called when a card is enriched/expanded. Flow:

```
GET /api/venue-policy?venue=Madison+Square+Garden
```

**Steps inside the route:**
1. **Check cache** — server-side `Map<string, VenuePolicy>` (lives for the lifetime of the serverless function; avoids re-fetching on every request)
2. **Web search** — fetch DuckDuckGo HTML search for `"{venue name}" bag policy clear bag allowed` → parse the top ~3 result URLs to find the official arena policy page
3. **Scrape** — fetch that URL, extract the text content (strip HTML tags)
4. **AI extraction** — send the text to Claude (haiku for speed/cost) with a prompt like:
   > "Extract the bag/item policy from this stadium page. Return JSON with: websiteUrl, clearBagRequired (bool), maxBagSize (string), items (array of {name, allowed})."
5. **Cache & return** — store in the Map, return the structured JSON

**Response shape:**
```json
{
  "websiteUrl": "https://www.msg.com/madison-square-garden",
  "policyUrl": "https://www.msg.com/.../bag-policy",
  "clearBagRequired": true,
  "maxBagSize": "12\" x 6\" x 12\"",
  "items": [
    { "name": "Clear bags (12x6x12)", "allowed": true },
    { "name": "Backpacks", "allowed": false },
    { "name": "Power banks", "allowed": true },
    { "name": "Outside food/drink", "allowed": false }
  ]
}
```

### 3. Client-side: dispatch from `bottom-tray.tsx`

When a card is clicked/expanded (same trigger as transit enrichment at line 560-588), also fire off the venue policy fetch:

- New state: `venuePolices: Record<string, VenuePolicy>` and `policyLoading: Set<string>`
- New function: `handlePolicyLoad(venueName)` — calls `/api/venue-policy?venue=...`, stores result
- Called alongside `handleEnrich` when card expands
- Results cached client-side by venue name (multiple games at same venue share the result)

### 4. UI in expanded card (`bottom-tray.tsx`)

**A) VENUE POLICY section** — between TRANSIT and LINKS (~line 759):

Loading state: "Loading policy..." spinner
Loaded state:
- One-line summary: "Clear bag required · Max 12"x6"x12""
- Toggle to expand full list (same pattern as Show Trains/Show Bus)
- Expanded: two groups — allowed (green check icon) / prohibited (red X icon)
- "View full policy →" link to `policyUrl`

**B) VENUE link in LINKS section** (~line 764):
```tsx
{policy?.websiteUrl && (
  <a href={policy.websiteUrl}>VENUE <ArrowUpRight /></a>
)}
```

### 5. Types: `src/lib/venue-policies.ts`
Shared interface used by both the API route and client:

```typescript
export interface PolicyItem { name: string; allowed: boolean; }
export interface VenuePolicy {
  websiteUrl: string;
  policyUrl: string;
  clearBagRequired: boolean;
  maxBagSize: string;
  items: PolicyItem[];
}
```

## Files to create/modify

| File | Change |
|------|--------|
| `src/lib/venue-policies.ts` | **New** — shared `VenuePolicy` type |
| `src/app/api/venue-policy/route.ts` | **New** — search + scrape + AI parse endpoint |
| `src/components/bottom-tray.tsx` | Add policy fetch on expand, VENUE POLICY section in UI, VENUE link in LINKS |
| `package.json` | Add `@anthropic-ai/sdk` dependency |
| `.env.local` | Add `ANTHROPIC_API_KEY` |

Note: No changes needed to the events API or page.tsx — policy data is fetched independently on the client side, not bundled with event data.

## Verification
1. `npm run dev`, expand a game card
2. See "Loading policy..." then the populated policy section
3. Verify clear-bag summary, allowed/prohibited items
4. Click "View full policy" → opens official arena page
5. Click "VENUE" in links → opens arena website
6. Collapse and re-expand same card → should load from cache instantly
7. Expand a different card at the same venue → should also be cached
