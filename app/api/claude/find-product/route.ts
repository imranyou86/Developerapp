import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson, fetchImageForClaude } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 90;

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
identified from a photo, and usually the actual photo itself — search the web to find the
closest real, currently-sold product(s) that match it.

When a photo is included, treat it as the source of truth and the text description as a hint,
not the other way around. Look closely at the photo yourself — exact color/finish (e.g. brushed
nickel vs. chrome vs. matte black), silhouette/shape, visible logos or model markings, handle or
knob style, pattern repeat and grout lines for tile, edge profile for countertops — before
searching, then actively cross-check each web search result's own product photos against what
you see in the given photo rather than matching on the text label alone. If a search result's
photo clearly doesn't match (wrong color, wrong shape) even though the name sounds right, don't
return it as an "exact" or "close" match — downgrade it to "similar" or drop it.

Don't stop at one generic search — a single broad query tends to surface blogs, Pinterest boards,
and marketplace listings instead of real catalog pages, which is why obviously-real products get
missed. Run several targeted searches against specific manufacturer and retailer catalogs
relevant to the category before concluding nothing matches, for example:
- Faucets/fixtures: Kohler, Delta, Moen, Grohe, American Standard, Signature Hardware, Ferguson
- Tile: Daltile, MSI Surfaces, Emser Tile, Fireclay Tile, Floor & Decor, The Tile Shop
- Flooring: Shaw, Mohawk, Bruce, Armstrong Flooring, Floor & Decor
- Countertops: Caesarstone, Cambria, MSI Surfaces, Silestone
- Cabinetry/hardware: KraftMaid, Emtek, Schlage, Top Knobs, Baldwin, Rejuvenation
- Lighting: Visual Comfort, Progress Lighting, Hinkley, Kichler
- Appliances: GE Profile, Bosch, KitchenAid, Wolf, Sub-Zero, Thermador
- General retailers worth a search regardless of category: Home Depot, Lowe's, Wayfair,
  Build.com, Ferguson
Try a manufacturer-specific search (e.g. "site:kohler.com [description]") as well as a general
one, and if the first couple of searches don't turn up a confident visual match, try rephrasing
the query (different terms for the same material/style) before giving up.

Prefer an exact make/model match when the photo and description are specific enough to identify
one. When they aren't, return the closest visual equivalent products instead.

Return up to 3 matches, ranked best first. For each:
- brand: manufacturer/brand name
- model: model name or number if known, else null
- description: a short description of the actual real product found
- price: approximate current price in USD as a plain number, or null if unknown
- url: a URL where this exact product can be viewed, or null if none found
- retailer: the site/retailer name for that URL, or null
- match_confidence: "exact" (this is almost certainly the exact product — visually confirmed
  against the photo, not just name-matched), "close" (same product line/very similar, photo
  mostly consistent), or "similar" (a reasonable equivalent, not the same product)

Be honest — if web search turns up nothing credible, or nothing that actually looks like the
photo, return an empty matches array rather than inventing or force-fitting a product.

Sometimes the request will list products the user has already been shown (under "Already
shown — find different ones"). Never repeat one of those (same brand+model, or same product
under a different retailer) — search further for other real, distinct products that still match
the visual description. It's fine for these to be a bit lower-confidence than a first search;
they must still be real, currently-sold products, not invented. If you genuinely can't find any
other distinct real product, return an empty matches array rather than repeating one already shown.

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
    imageUrl?: string | null;
    excludeMatches?: { brand: string; model: string | null; retailer: string | null }[];
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

    const excludeList =
      body.excludeMatches && body.excludeMatches.length > 0
        ? `\n\nAlready shown — find different ones:\n${body.excludeMatches
            .map((m) => `- ${m.brand}${m.model ? ` ${m.model}` : ""}${m.retailer ? ` (${m.retailer})` : ""}`)
            .join("\n")}`
        : "";

    // The source photo (when available) is included alongside the text so Claude can visually
    // cross-check search results against it instead of matching on the text label alone — the
    // text description is Claude's own earlier summary of the photo, so it's lossy on its own.
    let imageBlock: Anthropic.Messages.ImageBlockParam | null = null;
    if (body.imageUrl) {
      try {
        imageBlock = await fetchImageForClaude(body.imageUrl);
      } catch (err) {
        console.warn("find-product: could not fetch source image, continuing text-only:", err);
      }
    }

    const content: Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> = [
      { type: "text", text: `Find real product matches for this finish/fixture:\n\n${query}${excludeList}` },
    ];
    if (imageBlock) {
      content.push({ type: "text", text: "Source photo (the item is somewhere in this photo — this is the ground truth to match against):" });
      content.push(imageBlock);
    }

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      // Deliberately the basic search tool, not the newer web_search_20260209 —
      // that variant routes searches through a server-side Python sandbox for
      // dynamic filtering, which in testing took 60-90+ seconds (including
      // retries from Claude's own generated code failing) versus ~10-15s here.
      // That easily exceeds a serverless function's timeout for a feature
      // that doesn't need dynamic domain filtering anyway. max_uses raised
      // from 5 to 8 so the prompt's "try several manufacturer-specific
      // searches" instruction has room to actually run more than one or two.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      messages: [{ role: "user", content }],
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
