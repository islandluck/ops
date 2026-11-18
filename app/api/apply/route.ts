import { NextResponse, type NextRequest } from "next/server";
import { submitApplication } from "@/lib/talent";
import { MAX_RESUME_BYTES, RESUME_MIME_TYPES } from "@/lib/talent/storage";

export const runtime = "nodejs";

/**
 * Public job-application endpoint. A hosted job page's form POSTs here
 * (multipart, with the résumé file). We resolve the workspace from the job slug,
 * store the résumé in a private bucket, and record the candidate + application.
 * Mirrors the checkout route's "public form → workspace-scoped row" pattern.
 */
function baseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  const fd = await req.formData().catch(() => null);
  const base = baseUrl(req);
  const slug = String(fd?.get("job") ?? "").trim();
  const back = `${base}/jobs/${encodeURIComponent(slug)}`;
  if (!fd || !slug) return NextResponse.redirect(base, 303);

  // Honeypot — a hidden field real users never fill. If a bot filled it, pretend
  // success and drop the submission.
  if (String(fd.get("website") ?? "").trim()) return NextResponse.redirect(`${back}?applied=1`, 303);

  const name = String(fd.get("name") ?? "");
  const email = String(fd.get("email") ?? "");
  const phone = String(fd.get("phone") ?? "");
  const coverNote = String(fd.get("cover_note") ?? "");
  const links = String(fd.get("links") ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Screening answers: paired hidden prompt + answer, indexed qprompt_i / qanswer_i.
  const answers: { question: string; answer: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const q = String(fd.get(`qprompt_${i}`) ?? "").trim();
    const a = String(fd.get(`qanswer_${i}`) ?? "").trim();
    if (q && a) answers.push({ question: q, answer: a });
  }

  // Résumé file (required).
  const file = fd.get("resume");
  let resume: { bytes: Buffer; mime: string; filename: string } | null = null;
  if (file && typeof file === "object" && "arrayBuffer" in file) {
    const f = file as File;
    if (f.size > 0) {
      if (f.size > MAX_RESUME_BYTES) return NextResponse.redirect(`${back}?error=resume-too-big`, 303);
      const mime = f.type || "application/octet-stream";
      if (!RESUME_MIME_TYPES.includes(mime)) return NextResponse.redirect(`${back}?error=resume-type`, 303);
      resume = { bytes: Buffer.from(await f.arrayBuffer()), mime, filename: f.name || "resume" };
    }
  }
  if (!resume) return NextResponse.redirect(`${back}?error=resume-required`, 303);

  try {
    const r = await submitApplication({ jobSlug: slug, name, email, phone, coverNote, links, answers, resume });
    if (!r.ok) return NextResponse.redirect(`${back}?error=${encodeURIComponent(r.error)}`, 303);
    return NextResponse.redirect(`${back}?applied=1`, 303);
  } catch (e) {
    console.error("[apply] failed:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(`${back}?error=apply-failed`, 303);
  }
}
