import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 45;

interface ProductMatch {
  brand: string;
  model: string | null;
  description: string;
  price: number | null;
  url: string | null;
  retailer: string | null;
  match_confidence: "exact" | "close" | "similar";
}

interface FindProductResult {
  matches: ProductMatch[];
}

const SYSTEM_PROMPT = `You are a construction materials and fixtures researcher with real-time
web search access. You will be given a description of a finish, material, or fixture that was
identified from a photo — search the web to find the closest real, currently-sold product(s)
that match it.

Prefer well-known manufacturers and retailers (e.g. Kohler, Delta, Moen, Daltile, Caesarstone,
Shaw, Behr, Home Depot, Lowe's, Ferguson, Wayfair, Build.com) and prefer an exact make/model
match when the description is specific enough to identify one. When it isn't, return the closest
equivalent products instead.

Return up to 3 matches, ranked best first. For each:
- brand: manufacturer/brand name
- model: model name or number if known, else null
- description: a short description of the actual real product found
- price: approximate current price in USD as a plain number, or null if unknown
- url: a URL where this exact product can be viewed, or null if none found
- retailer: the site/retailer name for that URL, or null
- match_confidence: "exact" (this is almost certainly the exact product), "close" (same
  product line/very similar), or "similar" (a reasonable equivalent, not the same product)

Be honest — if web search turns up nothing credible, return an empty matches array rather than
inventing a product.

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "matches": [ { "brand": string, "model": string | null, "description": string, "price": number | null, "url": string | null, "retailer": string | null, "match_confidence": "exact" | "close" | "similar" } ] }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    name?: string;
    category?: string;
    description?: string;
    color?: string | null;
  };
  if (!body.name) {
    return NextResponse.json({ error: "No item provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();

    const query = [
      `Item: ${body.name}`,
      body.category && `Category: ${body.category}`,
      body.description && `Description: ${body.description}`,
      body.color && `Color: ${body.color}`,
    ]
      .filter(Boolean)
      .join("\n");

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages: [
        {
          role: "user",
          content: `Find real product matches for this finish/fixture:\n\n${query}`,
        },
      ],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (!text.trim()) {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<FindProductResult>(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("find-product failed", err);
    const message = err instanceof Error ? err.message : "Product search failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
