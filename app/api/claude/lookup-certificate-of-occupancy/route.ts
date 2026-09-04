import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface CertificateOfOccupancyResult {
  status: string | null;
  co_number: string | null;
  issued_date: string | null;
  open_clearances: { code: string | null; description: string }[];
  permits: { permit_number: string | null; type: string | null; status: string | null; issued_date: string | null; description: string | null }[];
  inspector: { name: string | null; phone: string | null; email: string | null; department: string | null } | null;
  source_url: string | null;
  confidence: "high" | "medium" | "low";
  notes: string;
}

const SYSTEM_PROMPT = `You are a Los Angeles building-department researcher. Given a property
address, search the web — primarily LADBS (Los Angeles Department of Building and Safety,
ladbs.org / ladbsservices2.lacity.org) permit and inspection record lookups, plus any other
public, sourced records you can find — to determine the property's Certificate of Occupancy
status and building-permit history. This only covers properties within the City of Los Angeles
(LADBS's jurisdiction) — if the address is clearly outside LA, say so plainly in notes and set
confidence to "low" rather than guessing.

Look for and report:
1. Certificate of Occupancy status — has one been issued for this property? If so, the CO number
   and issue date. If not issued/pending/unknown, say so plainly in "status".
2. Open or remaining clearances — any holds, corrections, or clearances still required before a
   Certificate of Occupancy could be issued (fire department sign-off, planning clearance,
   outstanding code violations, etc.), each with whatever code/description is available.
3. Issued permits — every building permit you can find on record for this address: permit
   number, permit type/description, its status (finaled/issued/expired/etc.), and issue date.
4. Inspector information — if a source lists a currently assigned building inspector for this
   address (name, phone, email, or department), include it; otherwise leave it null. Don't guess
   or invent a name.

This is inherently a best-effort web search, not a live query against LADBS's internal database —
LADBS's own permit-lookup portal is an interactive form that a general web search often can't
reach directly. Be honest about that limitation: if you can only find general/indirect
information rather than an authoritative per-address record, say so in notes and keep confidence
at "low" or "medium" rather than presenting search-engine guesses as fact. Never invent a CO
number, permit number, or inspector name — omit (use null, or an empty array) anything you can't
actually source.

Return:
- status: a short plain-language status (e.g. "Certificate of Occupancy issued", "Not yet
  issued", "Pending", "Could not determine"), or null if truly nothing was found
- co_number: the CO number if found, else null
- issued_date: the issue date if found (any reasonable date format), else null
- open_clearances: array of { "code": string | null, "description": string } — empty array if
  none found or none outstanding
- permits: array of { "permit_number": string | null, "type": string | null, "status": string |
  null, "issued_date": string | null, "description": string | null } — empty array if none found
- inspector: { "name": string | null, "phone": string | null, "email": string | null,
  "department": string | null } if any inspector info was found, else null
- source_url: the single most authoritative URL you found this from, else null
- confidence: "high" | "medium" | "low"
- notes: 1-3 sentences on what you found, what's missing, and the source(s) used

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "status": string | null, "co_number": string | null, "issued_date": string | null,
"open_clearances": [{ "code": string | null, "description": string }],
"permits": [{ "permit_number": string | null, "type": string | null, "status": string | null,
"issued_date": string | null, "description": string | null }],
"inspector": { "name": string | null, "phone": string | null, "email": string | null,
"department": string | null } | null, "source_url": string | null,
"confidence": "high" | "medium" | "low", "notes": string }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { address?: string };
  if (!body.address || !body.address.trim()) {
    return NextResponse.json({ error: "No address provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      // Basic search tool, not the sandboxed 20260209 variant — that one
      // took 60-90s+ in testing, well past a serverless function's timeout.
      // A few more uses than the single-fact lookups (zoning, property
      // details) since this covers four separate things (CO status,
      // clearances, permits, inspector).
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: [
        {
          role: "user",
          content: `Find the Certificate of Occupancy status, open clearances, issued permits, and inspector info (if available) for: ${body.address.trim()}`,
        },
      ],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new Error("No text response from Claude.");

    const result = extractJson<CertificateOfOccupancyResult>(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("lookup-certificate-of-occupancy failed", err);
    const message = err instanceof Error ? err.message : "Certificate of Occupancy lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
