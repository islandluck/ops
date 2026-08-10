import "server-only";

// NOTE: pdf-parse (→ pdfjs-dist) and mammoth are imported LAZILY inside
// extractDocText, never at module top level. pdfjs-dist references browser-only
// globals (DOMMatrix) at load and throws in the Node server runtime — a static
// import here would poison every server module that transitively imports this
// file (including the login page's server actions), 500-ing all of them.

/** Upper bound on an uploaded document (before extraction). */
export const MAX_DOC_BYTES = 20 * 1024 * 1024; // 20 MB
/** Per-document text cap — bounds downstream token cost. */
export const MAX_TEXT_CHARS = 200_000;

const DOC_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/plain",
  "text/markdown",
  "text/x-markdown",
] as const;

const TEXT_EXT = /\.(txt|md|markdown|text|csv|log)$/i;

/** Whether we can extract text from this upload (by MIME, with an extension fallback). */
export function isSupportedDoc(mime: string, filename: string): boolean {
  if ((DOC_MIME_TYPES as readonly string[]).includes(mime)) return true;
  if (/\.pdf$/i.test(filename)) return true;
  if (/\.docx$/i.test(filename)) return true;
  return TEXT_EXT.test(filename);
}

/** A short, human label for what we accept — used in UI copy + errors. */
export const SUPPORTED_DOC_LABEL = "PDF, Word (.docx), or text/markdown";

function normalizeText(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/ /g, " ") // non-breaking space -> normal space
    .replace(/[ \t]+\n/g, "\n") // strip trailing whitespace
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs
    .trim();
}

/** Extract plain text from an uploaded document. Server-only; returns "" on empty. */
export async function extractDocText(filename: string, mime: string, bytes: Buffer): Promise<string> {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  let text = "";

  if (mime === "application/pdf" || ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const res = await parser.getText();
      text = res.text ?? "";
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const mammoth = (await import("mammoth")).default;
    const res = await mammoth.extractRawText({ buffer: bytes });
    text = res.value ?? "";
  } else {
    // txt / md / csv / anything text-like
    text = bytes.toString("utf8");
  }

  return normalizeText(text).slice(0, MAX_TEXT_CHARS);
}
