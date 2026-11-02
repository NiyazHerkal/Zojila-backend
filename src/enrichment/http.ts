const TIMEOUT_MS = 5000;

// OpenStreetMap's tile policy requires an identifying User-Agent; harmless for other APIs.
const USER_AGENT = 'TravelGo-Backend/0.1 (+https://travelgo.app)';

export class HttpResponseError extends Error {
  constructor(readonly response: Response, url: string) {
    super(`HTTP ${response.status} from ${new URL(url).host}`);
  }
}

/** GET with a timeout. Third-party calls must never hang a user request. */
export async function fetchWithTimeout(
  url: string,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new HttpResponseError(res, url);
  return res;
}

/** Treats unset/blank env values as "no key yet" (keys arrive later from the lead). */
export function apiKey(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
