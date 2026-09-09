// Server-only. Thin wrapper around Resend's REST API (https://resend.com) —
// no SDK, matching this app's other external-API wrappers (lib/anthropic.ts,
// lib/openai.ts): plain fetch, one function, throws with the response body
// attached on failure. RESEND_API_KEY is read only here; never import this
// from a Client Component.

const RESEND_API_URL = "https://api.resend.com/emails";

function getApiKey(): string {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured on the server.");
  }
  return process.env.RESEND_API_KEY;
}

// Resend's shared "onboarding@resend.dev" sender works with no setup, but
// Resend then only delivers to the account owner's own verified email —
// fine for testing this feature yourself, not for real subscribers. Verify
// a domain in Resend's dashboard and set ALERT_FROM_EMAIL to an address on
// it (e.g. "alerts@yourdomain.com") before relying on this for other people.
const FROM_EMAIL = process.env.ALERT_FROM_EMAIL || "onboarding@resend.dev";

export async function sendEmail(input: { to: string; subject: string; text: string }): Promise<void> {
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error (${res.status}): ${body.slice(0, 500)}`);
  }
}
