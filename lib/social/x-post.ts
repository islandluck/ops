/**
 * X (Twitter) post composition + the 280-character limit — the SINGLE source of
 * truth. Pure and dependency-free so every drafting path (social agent, manual
 * task planner, "have agent do this", revisions) and the publish path all clamp
 * identically. If a post is over the limit anywhere, it flows through here.
 */

/** Max characters in a standard X post. */
export const X_MAX_CHARS = 280;

/** Trim text to the limit at a word boundary, adding an ellipsis. */
export function fitToX(text: string, limit: number = X_MAX_CHARS): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  const slice = t.slice(0, limit - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.trimEnd()}…`;
}

/**
 * Compose a post that fits the limit: fit the body, then append as many hashtags
 * as still fit, dropping the rest. Guarantees a result ≤ X_MAX_CHARS.
 */
export function composeXPost(body: string, hashtags: string[]): string {
  const text = fitToX(body);
  const kept: string[] = [];
  for (const tag of hashtags) {
    const candidate = `${text}\n\n${[...kept, `#${tag}`].join(" ")}`;
    if (candidate.length <= X_MAX_CHARS) kept.push(`#${tag}`);
  }
  return kept.length ? `${text}\n\n${kept.join(" ")}` : text;
}
