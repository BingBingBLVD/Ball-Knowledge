import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { VenuePolicy } from "@/lib/venue-policies";

const cache = new Map<string, VenuePolicy>();

const client = new Anthropic();

/** Use Claude to generate venue policy from its knowledge. */
async function generatePolicy(venueName: string): Promise<VenuePolicy | null> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a knowledgeable sports venue expert. Generate the bag and item policy for "${venueName}" (an NBA/sports arena) based on your knowledge.

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "websiteUrl": "the arena's main website URL (just the homepage, e.g. https://www.msg.com)",
  "policyUrl": "the arena's bag policy or A-Z guide URL if you know it, otherwise empty string",
  "clearBagRequired": true or false,
  "maxBagSize": "dimensions string like 14x14x6 or empty string if unknown",
  "items": [
    {"name": "item description", "allowed": true/false}
  ]
}

For the items array, include 6-12 of the most relevant items fans ask about:
- Bags: backpacks, purses, clear bags, fanny packs, diaper bags
- Electronics: power banks/portable chargers, cameras, laptops/tablets
- Other: outside food/drink, umbrellas, strollers, sealed water bottles

Mark each as allowed:true or allowed:false based on typical policy for this venue. Most NBA arenas enforce clear bag policies. Use your best knowledge — accuracy matters but a reasonable estimate based on common NBA arena policies is acceptable.`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  try {
    const parsed = JSON.parse(text);
    if (parsed.error) return null;
    return parsed as VenuePolicy;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const venue = searchParams.get("venue");
  if (!venue) {
    return NextResponse.json({ error: "venue param required" }, { status: 400 });
  }

  // Check cache
  if (cache.has(venue)) {
    return NextResponse.json(cache.get(venue));
  }

  try {
    const policy = await generatePolicy(venue);
    if (policy && policy.items && policy.items.length > 0) {
      cache.set(venue, policy);
      return NextResponse.json(policy);
    }

    return NextResponse.json(
      { error: "Could not generate policy" },
      { status: 404 }
    );
  } catch (error) {
    console.error("venue-policy error:", error);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
