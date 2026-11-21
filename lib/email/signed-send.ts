import "server-only";

import { getEmailSettingsFor } from "@/lib/agents/email-settings";
import { getImageBytes } from "@/lib/media/storage";
import {
  composeEmailHtml,
  renderSignatureText,
  signatureBlockActive,
} from "@/lib/email/signature";
import type { SignatureBlock } from "@/lib/types";

/** The signature-related fields spread into a sendGmail() call. */
export interface SignedEmail {
  /** Final text/plain body (message + plain-text signature fallback). */
  body: string;
  /** HTML alternative (message + formatted signature card). Omitted when no block. */
  html?: string;
  /** Inline images for the HTML (the signature logo), embedded via CID. */
  inlineImages?: { cid: string; mime: string; bytes: Buffer; filename?: string }[];
}

const LOGO_CID = "siglogo";

function logoFilename(mime: string | null): string {
  const ext = mime?.split("/")[1]?.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  return `logo.${ext}`;
}

/**
 * Attach the plane's formatted signature to an outgoing message. When the plane has
 * an active signature block, returns an HTML alternative (body + table-based card,
 * logo embedded inline via CID) plus a plain-text fallback. When there's no block,
 * returns the body unchanged (the plain-text sign-off is already in it) so sends
 * behave exactly as before. Best-effort: a missing logo degrades to a logo-less card.
 */
export async function buildSignedEmail(
  workspaceId: string,
  scopeUserId: string | null,
  body: string,
): Promise<SignedEmail> {
  let block: SignatureBlock | null | undefined;
  try {
    const settings = await getEmailSettingsFor(workspaceId, scopeUserId);
    block = settings.signature_block;
  } catch {
    return { body };
  }
  if (!signatureBlockActive(block)) return { body };

  // Fetch the logo bytes for inline embedding (best-effort).
  let logo: { bytes: Buffer; mime: string } | null = null;
  if (block.logo_path) {
    try {
      logo = await getImageBytes(block.logo_path);
    } catch {
      logo = null;
    }
  }

  const logoCid = logo ? LOGO_CID : undefined;
  const html = composeEmailHtml(body, block, { logoCid });
  const sigText = renderSignatureText(block);
  const text = sigText ? `${body.trimEnd()}\n\n${sigText}` : body;
  const inlineImages = logo
    ? [{ cid: LOGO_CID, mime: logo.mime, bytes: logo.bytes, filename: logoFilename(block.logo_mime) }]
    : undefined;

  return { body: text, html, inlineImages };
}
