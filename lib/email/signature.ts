/**
 * Email signature rendering — PURE and isomorphic (no server-only imports), so the
 * send path (lib/email/signed-send.ts) and the in-app live preview (the Email
 * settings builder) render byte-identical HTML from the same code.
 *
 * The output is deliberately old-school: a `<table>` with inline styles and no
 * class/`<style>` reliance, because that is the only markup that renders
 * consistently across Gmail, Outlook (Word engine), and Apple Mail. The logo is
 * referenced by `cid:` at send time so it displays even when the client blocks
 * external images; the in-app preview falls back to the public logo URL.
 */

import type { SignatureBlock, SignatureLayout } from "@/lib/types";

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DEFAULT_ACCENT = "#2563eb";
const MUTED = "#555555";
const BODY_COLOR = "#111111";
const LAYOUTS: SignatureLayout[] = ["logo-left", "stacked"];

/* ------------------------------- primitives ------------------------------- */

/** Escape the five HTML-significant characters so a field value can never inject markup. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Return a safe href, or "" if the value can't be trusted. Only http(s)/mailto/tel
 * are allowed — never javascript:, data:, etc. A bare domain (no scheme) is treated
 * as https. The result is HTML-escaped for use inside an attribute.
 */
export function safeUrl(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (/^(mailto:|tel:)/i.test(v)) return escapeHtml(v);
  let candidate = v;
  if (!/^https?:\/\//i.test(candidate)) {
    // Looks like a domain or path → assume https. Reject anything with a foreign scheme.
    if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return "";
    candidate = `https://${candidate}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return escapeHtml(u.toString());
  } catch {
    return "";
  }
}

/** A clean, human display form of a URL (scheme + leading www + trailing slash stripped). */
export function displayUrl(raw: string): string {
  return (raw ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** Accept only a #rrggbb hex; otherwise fall back. */
export function safeColor(raw: string, fallback = DEFAULT_ACCENT): string {
  return /^#[0-9a-fA-F]{6}$/.test((raw ?? "").trim()) ? raw.trim() : fallback;
}

function clampInt(n: unknown, min: number, max: number, dflt: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function str(v: unknown, max: number): string {
  return (typeof v === "string" ? v : "").slice(0, max).trim();
}

function firstName(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? "").trim();
}

/* ------------------------------ normalization ----------------------------- */

/** A blank, disabled signature block with sensible defaults. */
export function emptySignatureBlock(): SignatureBlock {
  return {
    enabled: false,
    name: "",
    title: "",
    company: "",
    phone: "",
    email: "",
    website: "",
    linkedin: "",
    tagline: "",
    accent: DEFAULT_ACCENT,
    layout: "logo-left",
    logo_path: null,
    logo_url: null,
    logo_mime: null,
    logo_width: 72,
  };
}

/** Coerce arbitrary input (DB JSON or client payload) into a valid, bounded block. */
export function normalizeSignatureBlock(raw: unknown): SignatureBlock {
  const r = (raw ?? {}) as Record<string, unknown>;
  const layout = LAYOUTS.includes(r.layout as SignatureLayout) ? (r.layout as SignatureLayout) : "logo-left";
  return {
    enabled: Boolean(r.enabled),
    name: str(r.name, 120),
    title: str(r.title, 160),
    company: str(r.company, 160),
    phone: str(r.phone, 60),
    email: str(r.email, 160),
    website: str(r.website, 300),
    linkedin: str(r.linkedin, 300),
    tagline: str(r.tagline, 200),
    accent: safeColor(typeof r.accent === "string" ? r.accent : DEFAULT_ACCENT),
    layout,
    logo_path: typeof r.logo_path === "string" && r.logo_path ? r.logo_path.slice(0, 500) : null,
    logo_url: typeof r.logo_url === "string" && r.logo_url ? r.logo_url.slice(0, 1000) : null,
    logo_mime: typeof r.logo_mime === "string" && r.logo_mime ? r.logo_mime.slice(0, 100) : null,
    logo_width: clampInt(r.logo_width, 24, 240, 72),
  };
}

/** True when the block should actually be rendered onto outgoing mail. */
export function signatureBlockActive(block: SignatureBlock | null | undefined): block is SignatureBlock {
  if (!block || !block.enabled) return false;
  return Boolean(block.name.trim() || block.company.trim() || block.logo_path || block.tagline.trim());
}

/** The short closing line baked into the body when a block is active ("Best,\nAlex"). */
export function closingFromBlock(block: SignatureBlock): string {
  const fn = firstName(block.name);
  return fn ? `Best,\n${fn}` : "Best,";
}

/* -------------------------------- rendering ------------------------------- */

function linkRow(label: string, href: string, accent: string): string {
  return `<a href="${href}" style="color:${accent};text-decoration:none;">${escapeHtml(label)}</a>`;
}

/** The inner text cell (name, title/company, phone, links, tagline) — shared by both layouts. */
function textCellHtml(block: SignatureBlock): string {
  const accent = safeColor(block.accent);
  const lines: string[] = [];

  if (block.name.trim()) {
    lines.push(
      `<div style="font-family:${FONT_STACK};font-size:15px;font-weight:700;color:${accent};line-height:1.3;">${escapeHtml(block.name)}</div>`,
    );
  }
  const roleParts = [block.title.trim(), block.company.trim()].filter(Boolean).map(escapeHtml);
  if (roleParts.length) {
    lines.push(
      `<div style="font-family:${FONT_STACK};font-size:13px;color:${BODY_COLOR};line-height:1.4;margin-top:2px;">${roleParts.join(", ")}</div>`,
    );
  }
  if (block.phone.trim()) {
    const tel = safeUrl(`tel:${block.phone.replace(/[^\d+]/g, "")}`);
    const label = escapeHtml(block.phone);
    const phoneHtml = tel
      ? `<a href="${tel}" style="color:${MUTED};text-decoration:none;">${label}</a>`
      : label;
    lines.push(
      `<div style="font-family:${FONT_STACK};font-size:13px;color:${MUTED};line-height:1.4;margin-top:2px;">${phoneHtml}</div>`,
    );
  }

  const links: string[] = [];
  const web = safeUrl(block.website);
  if (web) links.push(linkRow(displayUrl(block.website) || "Website", web, accent));
  const li = safeUrl(block.linkedin);
  if (li) links.push(linkRow("LinkedIn", li, accent));
  const mail = block.email.trim();
  if (mail) {
    const href = safeUrl(`mailto:${mail}`);
    if (href) links.push(linkRow(mail, href, accent));
  }
  if (links.length) {
    const sep = `<span style="color:#cccccc;"> · </span>`;
    lines.push(
      `<div style="font-family:${FONT_STACK};font-size:13px;line-height:1.5;margin-top:4px;">${links.join(sep)}</div>`,
    );
  }

  if (block.tagline.trim()) {
    lines.push(
      `<div style="font-family:${FONT_STACK};font-size:12px;color:${MUTED};font-style:italic;line-height:1.4;margin-top:6px;border-top:1px solid #e5e5e5;padding-top:6px;">${escapeHtml(block.tagline)}</div>`,
    );
  }
  return lines.join("");
}

function logoImgHtml(block: SignatureBlock, logoCid?: string): string {
  const src = logoCid ? `cid:${logoCid}` : block.logo_url;
  if (!src) return "";
  const w = clampInt(block.logo_width, 24, 240, 72);
  const alt = escapeHtml(block.company.trim() || block.name.trim() || "Logo");
  const safeSrc = logoCid ? `cid:${escapeHtml(logoCid)}` : safeUrl(block.logo_url ?? "");
  if (!safeSrc) return "";
  return `<img src="${safeSrc}" width="${w}" alt="${alt}" style="display:block;border:0;outline:none;width:${w}px;max-width:${w}px;height:auto;" />`;
}

/**
 * Render the signature to bulletproof, table-based HTML. Returns "" when the block
 * is inactive. Pass `logoCid` on the send path (inline image); omit it for the
 * in-app preview (falls back to the public logo URL).
 */
export function renderSignatureHtml(
  block: SignatureBlock | null | undefined,
  opts: { logoCid?: string } = {},
): string {
  if (!signatureBlockActive(block)) return "";
  const textCell = textCellHtml(block);
  const logo = logoImgHtml(block, opts.logoCid);

  let inner: string;
  if (logo && block.layout === "logo-left") {
    inner = `<tr>
<td valign="top" style="padding:0 14px 0 0;">${logo}</td>
<td valign="top" style="padding:0;">${textCell}</td>
</tr>`;
  } else if (logo) {
    inner = `<tr><td valign="top" style="padding:0 0 8px 0;">${logo}</td></tr>
<tr><td valign="top" style="padding:0;">${textCell}</td></tr>`;
  } else {
    inner = `<tr><td valign="top" style="padding:0;">${textCell}</td></tr>`;
  }

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
${inner}
</table>`;
}

/** Plain-text fallback for the text/plain MIME part. Returns "" when inactive. */
export function renderSignatureText(block: SignatureBlock | null | undefined): string {
  if (!signatureBlockActive(block)) return "";
  const lines: string[] = [];
  if (block.name.trim()) lines.push(block.name.trim());
  const role = [block.title.trim(), block.company.trim()].filter(Boolean).join(", ");
  if (role) lines.push(role);
  if (block.phone.trim()) lines.push(block.phone.trim());
  if (block.email.trim()) lines.push(block.email.trim());
  const web = displayUrl(block.website);
  if (web) lines.push(web);
  if (block.linkedin.trim()) lines.push(displayUrl(block.linkedin) || block.linkedin.trim());
  if (block.tagline.trim()) lines.push(block.tagline.trim());
  return lines.join("\n");
}

/* ------------------------------- body → html ------------------------------ */

const URL_RE = /\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/gi;
const BARE_EMAIL_RE = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;

/**
 * Convert a plain-text email body into a safe HTML fragment: everything escaped,
 * bare URLs and emails linkified, newlines → <br>. Used for the HTML part so the
 * message above the signature keeps its formatting.
 */
export function bodyToHtml(body: string): string {
  let html = escapeHtml(body);
  // Linkify URLs first (escaped text, so "&amp;" etc. inside the URL stays intact).
  html = html.replace(URL_RE, (m) => `<a href="${m}" style="color:${DEFAULT_ACCENT};">${m}</a>`);
  // Then bare emails that aren't already inside an href.
  html = html.replace(BARE_EMAIL_RE, (m, _e, offset: number, full: string) => {
    const before = full.slice(Math.max(0, offset - 8), offset);
    if (/(href|mailto:)/i.test(before)) return m;
    return `<a href="mailto:${m}" style="color:${DEFAULT_ACCENT};">${m}</a>`;
  });
  html = html.replace(/\r?\n/g, "<br/>");
  return `<div style="font-family:${FONT_STACK};font-size:14px;color:${BODY_COLOR};line-height:1.5;">${html}</div>`;
}

/**
 * The full HTML part for an outgoing email: the body, then (if active) the signature
 * card below a thin spacer. `logoCid` embeds the logo inline on the send path.
 */
export function composeEmailHtml(
  body: string,
  block: SignatureBlock | null | undefined,
  opts: { logoCid?: string } = {},
): string {
  const sig = renderSignatureHtml(block, opts);
  const sigHtml = sig
    ? `<div style="margin-top:18px;padding-top:4px;">${sig}</div>`
    : "";
  return `<div>${bodyToHtml(body)}${sigHtml}</div>`;
}
