import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

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

export interface ClaudeImageBlock {
  type: "image";
  source: { type: "base64"; media_type: "image/jpeg"; data: string };
}

// Fetches an image (e.g. a stored plan page or uploaded photo) and downscales
// it before sending to Claude. Multi-page plans and phone-camera photos are
// often large enough on their own — combined into one request they can blow
// past the Messages API's request-size limit (a 413). Claude also only
// processes images up to ~1568px on the long edge internally, so sending
// anything larger wastes bandwidth without improving accuracy.
const MAX_DIMENSION = 1568;

export async function fetchImageForClaude(url: string): Promise<ClaudeImageBlock> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const resized = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: resized.toString("base64") },
  };
}

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
