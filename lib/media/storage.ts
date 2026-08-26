import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Post-image storage on Supabase Storage. Binaries live in a public bucket; the
 * metadata (a `media` row) lives in Postgres. Uses the service role — this only
 * ever runs server-side.
 */

const BUCKET = "post-media";
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Create the public bucket if it doesn't exist yet (idempotent). */
export async function ensureBucket(): Promise<void> {
  const supa = serviceClient();
  const { data } = await supa.storage.listBuckets();
  if (!data?.some((b) => b.name === BUCKET)) {
    await supa.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: "10MB",
      allowedMimeTypes: IMAGE_MIME_TYPES,
    });
  }
}

/** Upload image bytes; returns the storage path + a public URL. */
export async function uploadImageBytes(
  workspaceId: string,
  mediaId: string,
  bytes: Buffer,
  mime: string,
): Promise<{ path: string; publicUrl: string }> {
  await ensureBucket();
  const supa = serviceClient();
  const path = `${workspaceId}/${mediaId}.${EXT[mime] ?? "jpg"}`;
  const { error } = await supa.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

/** Download the binary for a stored image (used to re-upload to X on publish). */
export async function getImageBytes(path: string): Promise<{ bytes: Buffer; mime: string }> {
  const supa = serviceClient();
  const { data, error } = await supa.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Image download failed: ${error?.message ?? "not found"}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes, mime: data.type || "image/jpeg" };
}

/** Remove a stored image (best-effort). */
export async function deleteImageAt(path: string): Promise<void> {
  try {
    await serviceClient().storage.from(BUCKET).remove([path]);
  } catch {
    /* best-effort — the metadata row is the source of truth */
  }
}

/* --------------------------- email attachments --------------------------- */

// A separate PRIVATE bucket — attachments can be any file type (docs, PDFs) and
// shouldn't be world-readable; we fetch the bytes server-side to send.
const ATTACH_BUCKET = "email-attachments";
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB

async function ensureAttachBucket(): Promise<void> {
  const supa = serviceClient();
  const { data } = await supa.storage.listBuckets();
  if (!data?.some((b) => b.name === ATTACH_BUCKET)) {
    await supa.storage.createBucket(ATTACH_BUCKET, { public: false, fileSizeLimit: "20MB" });
  }
}

/** Upload an email attachment (any type). Returns the storage path (private). */
export async function uploadAttachmentBytes(
  workspaceId: string,
  id: string,
  bytes: Buffer,
  mime: string,
  filename: string,
): Promise<{ path: string }> {
  await ensureAttachBucket();
  const supa = serviceClient();
  const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "bin";
  const path = `${workspaceId}/${id}.${ext}`;
  const { error } = await supa.storage.from(ATTACH_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`Attachment upload failed: ${error.message}`);
  return { path };
}

/** Download an attachment's bytes (server-side, to include on send). */
export async function getAttachmentBytes(path: string): Promise<{ bytes: Buffer; mime: string }> {
  const supa = serviceClient();
  const { data, error } = await supa.storage.from(ATTACH_BUCKET).download(path);
  if (error || !data) throw new Error(`Attachment download failed: ${error?.message ?? "not found"}`);
  return { bytes: Buffer.from(await data.arrayBuffer()), mime: data.type || "application/octet-stream" };
}

/** Remove a stored attachment (best-effort). */
export async function deleteAttachmentAt(path: string): Promise<void> {
  try {
    await serviceClient().storage.from(ATTACH_BUCKET).remove([path]);
  } catch {
    /* best-effort */
  }
}
