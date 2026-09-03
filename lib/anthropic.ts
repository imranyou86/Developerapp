import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

// Server-only. Never import this file from a Client Component.
export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export const CLAUDE_MODEL = "claude-sonnet-5";

// Pulls the first JSON object/array out of a Claude text response, tolerating
// stray prose or markdown code fences around it.
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start === -1) {
    throw new Error("No JSON found in model response.");
  }
  const candidate = raw.slice(start);
  let depth = 0;
  let end = -1;
  const open = candidate[0];
  const close = open === "[" ? "]" : "}";
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] === open) depth++;
    else if (candidate[i] === close) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const jsonText = end === -1 ? candidate : candidate.slice(0, end + 1);
  return JSON.parse(jsonText) as T;
}
