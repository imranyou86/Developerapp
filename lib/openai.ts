import sharp from "sharp";

// Server-only. Thin wrapper around OpenAI's image generation API — never
// import this from a Client Component. OPENAI_API_KEY is read here only;
// the browser never sees it. This is a separate, optional integration from
// Claude — Claude has no image-generation capability of its own, so an
// auto-generate feature has to call out to OpenAI.

function getApiKey(): string {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured on the server. Add it to generate images automatically — " +
        "until then, copy the prompt into ChatGPT/an image tool by hand."
    );
  }
  return process.env.OPENAI_API_KEY;
}

export interface GeneratedImage {
  base64: string;
  mimeType: "image/png";
}

// gpt-image-1 always returns b64_json (no url response format), so the
// caller gets image bytes directly rather than a remote URL to re-fetch.
export async function generateRoomImage(prompt: string): Promise<GeneratedImage> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: "medium",
      n: 1,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI image generation failed (${res.status}): ${text.slice(0, 500)}`);
  }

  let json: { data?: { b64_json?: string }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI returned a non-JSON response: ${text.slice(0, 200)}`);
  }

  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI response did not include image data.");

  return { base64: b64, mimeType: "image/png" };
}

const EDIT_MAX_DIMENSION = 1536;

// Interior Design tab: takes a real photo of an empty/framed room and
// asks gpt-image-1 to redesign it in place (OpenAI's image *edit*
// endpoint — image-to-image — rather than generating from scratch, so the
// room's actual architecture/windows/layout come through in the result).
// Downscales to a sane max dimension and normalizes to PNG first — phone
// photos can be large enough to be slow/rejected otherwise, and gpt-image-1
// prefers PNG for edits.
export async function editRoomImage(imageUrl: string, prompt: string): Promise<GeneratedImage> {
  const sourceRes = await fetch(imageUrl);
  if (!sourceRes.ok) throw new Error(`Failed to fetch the room photo: ${sourceRes.status}`);
  const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());

  const pngBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: EDIT_MAX_DIMENSION, height: EDIT_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("size", "1536x1024");
  form.append("quality", "medium");
  form.append("n", "1");
  form.append("image", new Blob([pngBuffer], { type: "image/png" }), "room.png");

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${getApiKey()}` },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI image edit failed (${res.status}): ${text.slice(0, 500)}`);
  }

  let json: { data?: { b64_json?: string }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI returned a non-JSON response: ${text.slice(0, 200)}`);
  }

  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI response did not include image data.");

  return { base64: b64, mimeType: "image/png" };
}
