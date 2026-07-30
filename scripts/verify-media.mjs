// Verifies the image data path (what uploadPostImageAction does): upload a binary
// to Supabase Storage, insert a media row, read it back, fetch the public URL,
// then clean up. Safe + self-contained. Usage: node scripts/verify-media.mjs
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env.local" });

const email = process.argv[2] || "laronburrows@gmail.com";
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data } = await supa.auth.admin.listUsers();
const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
if (!u) { console.error("No user for", email); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 2 });
const BUCKET = "post-media";
const taskId = randomUUID(); // stand-in for a content task
const storageKey = randomUUID();
let mediaId = null, storagePath = null, pass = false;
try {
  const [wm] = await sql`select workspace_id from workspace_members where user_id=${u.id} limit 1`;
  const ws = wm.workspace_id;

  // 1) upload a 1x1 PNG (same as the action's uploadImageBytes)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  storagePath = `${ws}/${storageKey}.png`;
  const up = await supa.storage.from(BUCKET).upload(storagePath, png, { contentType: "image/png", upsert: true });
  if (up.error) throw new Error("upload: " + up.error.message);
  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(storagePath);
  console.log("① uploaded to storage; public URL generated");

  // 2) insert the media row (same shape as insertMedia)
  mediaId = randomUUID();
  await sql`insert into media (id, workspace_id, task_id, source, storage_path, public_url, mime_type, byte_size)
    values (${mediaId}, ${ws}, ${taskId}, ${"upload"}, ${storagePath}, ${pub.publicUrl}, ${"image/png"}, ${png.length})`;
  console.log("② inserted media row");

  // 3) read back (same query as listMediaForTask)
  const rows = await sql`select id, public_url, source, mime_type from media where workspace_id=${ws} and task_id=${taskId} order by created_at`;
  console.log(`③ listMediaForTask → ${rows.length} image(s):`, rows.map((r) => `${r.source}/${r.mime_type}`).join(", "));

  // 4) fetch the public URL
  const r = await fetch(pub.publicUrl);
  console.log("④ fetch public URL →", r.status, r.headers.get("content-type"));

  pass = rows.length === 1 && rows[0].id === mediaId && r.ok && r.headers.get("content-type")?.startsWith("image/");
  console.log(pass ? "\nPASS ✓ image upload → store → list → serve works" : "\nFAIL ✗");
} finally {
  if (mediaId) await sql`delete from media where id=${mediaId}`;
  if (storagePath) await supa.storage.from(BUCKET).remove([storagePath]);
  console.log("⑤ cleaned up (media row + storage object)");
  await sql.end();
}
process.exit(pass ? 0 : 1);
