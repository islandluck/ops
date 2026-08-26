/**
 * Dependency-free Markdown → HTML for the content engine. Covers the subset our
 * generator produces: headings, bold/italic/inline-code, links, unordered +
 * ordered lists, blockquotes, horizontal rules, and paragraphs. Everything is
 * HTML-escaped first, so rendered output is safe to host and safe to paste.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline transforms on an already-escaped line: links, bold, italic, code. */
function inline(escaped: string): string {
  let s = escaped;
  // Inline code first so its contents aren't further transformed.
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // Links [text](url) — only http(s) URLs, to keep output safe.
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => {
    const safeUrl = url.replace(/"/g, "%22");
    return `<a href="${safeUrl}" rel="noopener noreferrer" target="_blank">${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  return s;
}

/** A GFM table separator row, e.g. `|----|----|` or `| :-- | --: |`. */
function isTableSeparator(s: string): boolean {
  const t = s.trim();
  return t.includes("-") && /^\|?[\s:|-]*-[\s:|-]*\|?$/.test(t);
}

/** Split a table row into trimmed cells, dropping the outer pipes. */
function splitTableRow(s: string): string[] {
  let t = s.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

/** Convert a Markdown string into a clean, safe HTML fragment. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];
  // Running number for an ordered list, kept alive across explanation paragraphs
  // between items so a list broken up by prose still counts 1, 2, 3… even when the
  // model types "1." for every item. Reset to null on a section break.
  let olRun: number | null = null;

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      // A whole paragraph that is just one bold span is a section label
      // (e.g. "**BATCH 2: …**") — it ends the current ordered-list run.
      if (/^\*\*[^*]+\*\*$/.test(text)) olRun = null;
      out.push(`<p>${inline(escapeHtml(text))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      olRun = null;
      out.push("<hr />");
      i++;
      continue;
    }

    // Headings.
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      olRun = null;
      const level = Math.min(h[1].length, 6);
      out.push(`<h${level}>${inline(escapeHtml(h[2].trim()))}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote (one or more consecutive `>` lines).
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      olRun = null;
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(escapeHtml(quote.join(" ")))}</blockquote>`);
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      olRun = null;
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(escapeHtml(lines[i].trim().replace(/^[-*]\s+/, "")))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list. Uses a running counter (olRun) that survives explanation
    // paragraphs between items, so a list broken up by prose still counts 1, 2,
    // 3… even when the model types "1." for every item. The counter resets on a
    // section break (heading, hr, bold-only label, other list, table), so grouped
    // "batch" plans restart at 1 per group.
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushPara();
      if (olRun === null) {
        const typed = parseInt(trimmed.match(/^(\d+)/)?.[1] ?? "1", 10);
        olRun = Number.isFinite(typed) ? typed : 1;
      }
      const start = olRun;
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(escapeHtml(lines[i].trim().replace(/^\d+[.)]\s+/, "")))}</li>`);
        olRun += 1;
        i++;
      }
      const startAttr = start !== 1 ? ` start="${start}"` : "";
      out.push(`<ol${startAttr}>${items.join("")}</ol>`);
      continue;
    }

    // GFM table: a header row (with pipes) + a separator row + body rows.
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1].trim())) {
      flushPara();
      olRun = null;
      const header = splitTableRow(trimmed);
      i += 2; // consume the header + separator rows
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i].trim()));
        i++;
      }
      const cols = header.length;
      const thead = `<thead><tr>${header.map((c) => `<th>${inline(escapeHtml(c))}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => {
          // Pad/truncate each row to the header's column count so cells align.
          const cells = Array.from({ length: cols }, (_, idx) => r[idx] ?? "");
          return `<tr>${cells.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join("")}</tr>`;
        })
        .join("")}</tbody>`;
      out.push(`<div class="md-table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // Paragraph text (accumulate soft-wrapped lines).
    para.push(trimmed);
    i++;
  }
  flushPara();
  return out.join("\n");
}

/** Strip Markdown to readable plain text (for excerpts / previews). */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^>\s?/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
