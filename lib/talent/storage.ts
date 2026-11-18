import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Résumé storage on Supabase Storage — a PRIVATE bucket (résumés are personal
 * data, never world-readable). Candidates upload through the public apply form;
 * the owner views a résumé through a short-lived SIGNED URL. Service-role only,
 * server-side.
 */

const RESUME_BUCKET = "resumes";
export const RESUME_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];
export const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureResumeBucket(): Promise<void> {
  const supa = serviceClient();
  const { data } = await supa.storage.listBuckets();
  if (!data?.some((b) => b.name === RESUME_BUCKET)) {
    await supa.storage.createBucket(RESUME_BUCKET, { public: false, fileSizeLimit: "12MB" });
  }
}

/** Upload a résumé (pdf/doc/txt). Returns the private storage path. */
export async function uploadResumeBytes(
  workspaceId: string,
  id: string,
  bytes: Buffer,
  mime: string,
  filename: string,
): Promise<{ path: string }> {
  await ensureResumeBucket();
  const supa = serviceClient();
  const ext = (filename.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "pdf";
  const path = `${workspaceId}/${id}.${ext}`;
  const { error } = await supa.storage.from(RESUME_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`Résumé upload failed: ${error.message}`);
  return { path };
}

/** A short-lived signed URL the owner can open to view a résumé (default 10 min). */
export async function resumeSignedUrl(path: string, expiresIn = 600): Promise<string | null> {
  try {
    const supa = serviceClient();
    const { data, error } = await supa.storage.from(RESUME_BUCKET).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Remove a stored résumé (best-effort). */
export async function deleteResumeAt(path: string): Promise<void> {
  try {
    await serviceClient().storage.from(RESUME_BUCKET).remove([path]);
  } catch {
    /* best-effort */
  }
}
