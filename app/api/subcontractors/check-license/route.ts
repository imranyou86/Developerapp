import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 20;

// CSLB's own check-license tool serves a direct result for a GET request
// with the license number in the query string — no form POST/ASP.NET
// ViewState dance needed, unlike a lot of interactive government lookups
// (LADBS's property tool, which this app already gave up scraping — see
// Certificate of Occupancy — genuinely requires simulating a form
// submission, which is why that one instead just links out). CSLB's is
// simple enough to fetch and parse server-side directly.
const CSLB_DETAIL_URL = "https://www2.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=";

const NOT_FOUND_PATTERNS = [/does not have a license/i, /no record/i, /not found/i, /invalid license/i];

// CSLB's own vocabulary for this field — see cslb.ca.gov's public guidance
// on what each status means. Checked in this order since "current and
// active" both appearing wouldn't match "active" alone first if checked in
// alphabetical order instead.
const STATUS_WORDS = [
  "current and active",
  "active",
  "inactive",
  "suspended",
  "revoked",
  "expired",
  "cancelled",
  "canceled",
  "pending",
  "delinquent",
  "reinstated",
  "deceased",
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function findStatus(text: string): { status: string | null; context: string | null } {
  // Highest-confidence signal: CSLB's own summary sentence at the top of a
  // valid record ("This license is current and active.", "This license is
  // suspended.", etc.) — checked before the "License Status" label lookup
  // below since it's less likely to collide with an unrelated field (bond/
  // workers' comp also render their own "Active"/"Inactive" values further
  // down the same page).
  const sentence = text.match(/this license is\s+([a-z ]{3,30}?)[.\s]/i);
  if (sentence) {
    const phrase = sentence[1].trim().toLowerCase();
    const known = STATUS_WORDS.find((w) => phrase.includes(w));
    if (known) return { status: known, context: sentence[0].trim() };
  }

  const labelIndex = text.toLowerCase().indexOf("license status");
  if (labelIndex !== -1) {
    const window = text.slice(labelIndex, labelIndex + 160);
    const windowLower = window.toLowerCase();
    const known = STATUS_WORDS.find((w) => windowLower.includes(w));
    if (known) return { status: known, context: window.trim() };
    return { status: null, context: window.trim() };
  }

  return { status: null, context: null };
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { licenseNumber?: string };
  const licenseNumber = (body.licenseNumber ?? "").replace(/\D/g, "");
  if (!licenseNumber) {
    return NextResponse.json({ error: "No license number provided." }, { status: 400 });
  }

  try {
    const res = await fetch(`${CSLB_DETAIL_URL}${encodeURIComponent(licenseNumber)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlaiaHomesDev/1.0; +https://alaiahomesdev.com)",
      },
      // CSLB's own page, not user-controlled — safe to follow redirects.
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `CSLB returned an error (${res.status}).` }, { status: 502 });
    }
    const html = await res.text();
    const text = stripHtml(html);

    if (NOT_FOUND_PATTERNS.some((p) => p.test(text))) {
      return NextResponse.json({ found: false });
    }

    const { status, context } = findStatus(text);
    return NextResponse.json({ found: true, status, context });
  } catch (err) {
    console.error("check-license failed", err);
    const message = err instanceof Error ? err.message : "License check failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
