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
