// Client-safe. Safari (and some mobile browsers, especially over a flaky
// connection) surface a transient network hiccup as a bare
// `TypeError: Load failed` / `Failed to fetch` — the fetch() call itself
// throws, no HTTP response at all. These are usually transient (a dropped
// connection, a cold serverless function) and worth a couple of silent
// retries before bothering the user with an error toast. A real HTTP error
// response (4xx/5xx with a JSON body) is NOT retried here — that's a
// legitimate application error the caller should surface, not a network
// blip.
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("load failed") || msg.includes("failed to fetch") || msg.includes("network");
}

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, retries = 2): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (!isNetworkError(err) || attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
