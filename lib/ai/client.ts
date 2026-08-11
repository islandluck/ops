import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { recordAiUsage } from "@/lib/ai/usage";

/**
 * Shared, metered Anthropic client. Every /v1/messages response's token usage is
 * recorded (attributed to the current workspace via lib/ai/usage.ts) by a wrapping
 * fetch — so no call site has to change beyond `new Anthropic()` → `getAnthropic()`.
 */

/** A fetch that records Claude token usage from every messages response, then returns it untouched. */
const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  try {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (res.ok && url.includes("/v1/messages")) {
      // Read a CLONE so the SDK still gets the original body. Only messages
      // responses carry `usage`; anything else (or a stream) is ignored.
      void res
        .clone()
        .json()
        .then((body: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }) => {
          if (body?.usage) {
            recordAiUsage({
              model: body.model ?? "",
              input_tokens: body.usage.input_tokens ?? 0,
              output_tokens: body.usage.output_tokens ?? 0,
            });
          }
        })
        .catch(() => {});
    }
  } catch {
    /* metering must never break the request */
  }
  return res;
};

let _client: Anthropic | null = null;

/**
 * The metered Anthropic client. Pass opts only when a call needs non-default
 * retries/timeout (those bypass the cached singleton). Throws if the key is missing.
 */
export function getAnthropic(opts?: { maxRetries?: number; timeout?: number }): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  if (!opts && _client) return _client;
  const client = new Anthropic({
    apiKey,
    maxRetries: opts?.maxRetries ?? 2,
    ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    fetch: recordingFetch,
  });
  if (!opts) _client = client;
  return client;
}
