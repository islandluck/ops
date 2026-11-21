import "server-only";

/**
 * Shared HTTP helper for outbound integration calls. Node's global fetch (undici) defaults
 * to ~5-minute header/body timeouts — far too long for a server action, which runs requests
 * sequentially, so one hung external API would freeze the app and queue every later action
 * behind it. `fetchWithTimeout` bounds each call. A thrown TimeoutError is an Error, so the
 * existing try/catch + `!res.ok` handling in each integration degrades it gracefully.
 */

/** Default timeout for an outbound integration HTTP call (ms). */
export const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/** fetch() with a timeout applied — unless the caller already passed its own `signal`. */
export function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}
