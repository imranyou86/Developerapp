import sharp from "sharp";

// Server-only. Thin wrapper around Google's Gemini API image model — never
// import this from a Client Component. GEMINI_API_KEY is read here only;
// the browser never sees it. This is a separate, optional integration from
// Claude — Claude has no image-generation capability of its own, so an
// auto-generate feature has to call out to a dedicated image model. Same
// plain-fetch, no-SDK style as lib/anthropic.ts/lib/email.ts.
//
// Model: Gemini 3 Pro Image ("Nano Banana Pro") — the Pro tier above the
// Flash model this used previously ("Gemini 3.1 Flash Image"/"Nano Banana
// 2"), chosen for noticeably higher detail/accuracy per Google's own
// materials, at a real cost/latency tradeoff (Pro-tier image tokens price
// meaningfully higher than Flash's). Overridable via GEMINI_IMAGE_MODEL
// without a code change — e.g. to fall back to the Flash model
// ("gemini-3.1-flash-image") if Pro's cost/latency isn't worth it for this
// use, or to correct the id below if Google renames/GAs it. This sandbox
// has no network access to verify the exact preview id or request shape
// against a live key — confirm generation still works after deploying.
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getApiKey(): string {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured on the server. Add it to generate images automatically — " +
        "until then, copy the prompt into an image tool by hand."
    );
  }
  return process.env.GEMINI_API_KEY;
}

export interface GeneratedImage {
  base64: string;
  mimeType: "image/png";
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiGenerateContentResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}

function extractImage(json: GeminiGenerateContentResponse): GeneratedImage {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData) throw new Error("Gemini response did not include image data.");
  return { base64: imagePart.inlineData.data, mimeType: "image/png" };
}

// 3:2 matches the room-photo framing this app has always used. "2K" trades
// some latency/cost for the sharper detail that's the actual point of
// using the Pro-tier model above — drop to "1K" if that tradeoff isn't
// worth it, or up to "4K" if Pro's ceiling is ever worth the extra cost.
async function callGemini(parts: GeminiPart[]): Promise<GeneratedImage> {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "3:2", imageSize: "2K" },
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini image request failed (${res.status}): ${text.slice(0, 500)}`);
  }

  let json: GeminiGenerateContentResponse;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned a non-JSON response: ${text.slice(0, 200)}`);
  }

  return extractImage(json);
}

export async function generateRoomImage(prompt: string): Promise<GeneratedImage> {
  return callGemini([{ text: prompt }]);
}

const EDIT_MAX_DIMENSION = 1536;

// Shared by editRoomImage and generateRoomImageFromPlan below — fetches a
// source image and normalizes it to a size-capped PNG inlineData part.
// Downscaling first matters for both: a phone photo can be large enough to
// be slow, and a scanned plan sheet can be large enough to blow past
// request-size limits once several are attached to one call.
async function fetchAndNormalizeImage(url: string): Promise<GeminiPart> {
  const sourceRes = await fetch(url);
  if (!sourceRes.ok) throw new Error(`Failed to fetch image: ${sourceRes.status}`);
  const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());

  const pngBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: EDIT_MAX_DIMENSION, height: EDIT_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  return { inlineData: { mimeType: "image/png", data: pngBuffer.toString("base64") } };
}

// Interior Design/Landscape tabs: takes a real photo (an empty/framed
// room, or a house exterior) and asks Gemini to redesign it in place —
// image-to-image via an inlineData part alongside the text instruction,
// rather than generating from scratch, so the actual architecture/
// structure comes through in the result.
export async function editRoomImage(imageUrl: string, prompt: string): Promise<GeneratedImage> {
  const imagePart = await fetchAndNormalizeImage(imageUrl);
  return callGemini([imagePart, { text: prompt }]);
}

// Caps how many plan sheets get attached to one call — most constructions
// have one layout sheet per floor, and this keeps the request a
// reasonable size regardless.
const PLAN_IMAGE_LIMIT = 4;

// Rooms tab: grounds a from-scratch room render in the construction's own
// floor plan sheet(s) instead of inventing a generic room from a text
// description alone — the only real layout signal available before any
// actual photo of the room exists (once one does, editRoomImage above is
// the stronger path). Gemini is asked to find the named room on the
// attached plan sheet(s) and use its real wall/window/door layout as the
// basis for the photo.
export async function generateRoomImageFromPlan(
  planImageUrls: string[],
  roomName: string,
  floor: number | null,
  prompt: string
): Promise<GeneratedImage> {
  const urls = planImageUrls.slice(0, PLAN_IMAGE_LIMIT);
  const planParts = await Promise.all(urls.map((url) => fetchAndNormalizeImage(url)));

  const focusInstruction = `The attached image(s) are this construction's architectural floor plan sheet(s). Find the room
labeled "${roomName}"${floor != null ? ` (floor ${floor})` : ""} on the plan and use its exact wall
outline, window and door positions, and proportions as the basis for the photograph described
next — the result needs to be recognizable as that specific room's real layout, not a generic
room of the same type. Ignore every other room on the sheet.`;

  return callGemini([...planParts, { text: focusInstruction }, { text: prompt }]);
}
