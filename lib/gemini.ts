import sharp from "sharp";

// Server-only. Thin wrapper around Google's Gemini API image model (Gemini
// 3.1 Flash Image, aka "Nano Banana 2") — never import this from a Client
// Component. GEMINI_API_KEY is read here only; the browser never sees it.
// This is a separate, optional integration from Claude — Claude has no
// image-generation capability of its own, so an auto-generate feature has
// to call out to a dedicated image model. Swapped in from OpenAI's
// gpt-image-1: stronger photorealism and edit consistency (preserving a
// real room photo's architecture while restyling it) at a lower per-image
// cost. Same plain-fetch, no-SDK style as lib/anthropic.ts/lib/email.ts.

const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
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

// 3:2 matches the room-photo framing this app has always used
// (gpt-image-1's old 1536x1024 output); "1K" keeps cost/latency comparable
// to that — bump to "2K"/"4K" in imageConfig below if higher fidelity is
// ever worth the extra cost.
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
        imageConfig: { aspectRatio: "3:2", imageSize: "1K" },
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

// Interior Design/Landscape tabs: takes a real photo (an empty/framed
// room, or a house exterior) and asks Gemini to redesign it in place —
// image-to-image via an inlineData part alongside the text instruction,
// rather than generating from scratch, so the actual architecture/
// structure comes through in the result. Downscales and normalizes to PNG
// first — phone photos can be large enough to be slow otherwise.
export async function editRoomImage(imageUrl: string, prompt: string): Promise<GeneratedImage> {
  const sourceRes = await fetch(imageUrl);
  if (!sourceRes.ok) throw new Error(`Failed to fetch the room photo: ${sourceRes.status}`);
  const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());

  const pngBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: EDIT_MAX_DIMENSION, height: EDIT_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  return callGemini([{ inlineData: { mimeType: "image/png", data: pngBuffer.toString("base64") } }, { text: prompt }]);
}
