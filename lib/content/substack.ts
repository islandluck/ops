import { escapeHtml, markdownToHtml } from "./format";

/**
 * Substack handoff — Substack has no publish API, so we format the post perfectly
 * for a paste into its editor. `html` is rich content the Substack editor imports
 * with formatting intact; `markdown` is a portable download. (Slice 2 adds an
 * optional session-token draft-push; this stays the reliable, no-credential path.)
 */

export interface SubstackHandoff {
  /** Rich HTML to copy → paste into Substack's editor (headings, lists, links). */
  html: string;
  /** Portable Markdown for the .md download. */
  markdown: string;
}

export function buildSubstackHandoff(post: {
  title: string;
  dek: string;
  body_md: string;
  hero_image_url?: string | null;
}): SubstackHandoff {
  const hero = post.hero_image_url?.trim();
  const htmlParts = [
    `<h1>${escapeHtml(post.title)}</h1>`,
    post.dek.trim() ? `<p><em>${escapeHtml(post.dek)}</em></p>` : "",
    hero ? `<p><img src="${hero.replace(/"/g, "%22")}" alt="" /></p>` : "",
    markdownToHtml(post.body_md),
  ].filter(Boolean);

  const mdParts = [
    `# ${post.title}`,
    post.dek.trim() ? `_${post.dek}_` : "",
    hero ? `![](${hero})` : "",
    post.body_md.trim(),
  ].filter(Boolean);

  return { html: htmlParts.join("\n"), markdown: mdParts.join("\n\n") };
}
