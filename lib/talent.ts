import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, candidates, jobPosts, workspaces } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { draftJobDescription, type JobDraft } from "@/lib/ai/job";
import { draftHiringEmail, type HiringEmailKind } from "@/lib/ai/hire-email";
import { screenCandidate, type ScreenResult } from "@/lib/ai/screen";
import { draftOutreach, scoutCandidates } from "@/lib/ai/scout";
import { tavilyConfigured, tavilySearch } from "@/lib/integrations/tavily";
import { stageOutboundDraft } from "@/lib/agents/outbound";
import { runWithUsage } from "@/lib/ai/usage";
import { extractDocText } from "@/lib/deepdive/extract";
import { getValidAccessToken } from "@/lib/integrations/tokens";
import { createZoomMeeting } from "@/lib/integrations/zoom";
import { createCalendarEvent } from "@/lib/integrations/google";
import { downloadResumeBytes, resumeSignedUrl, uploadResumeBytes } from "@/lib/talent/storage";
import type {
  Application,
  ApplicationEval,
  ApplicationStage,
  Candidate,
  EmploymentType,
  JobPost,
  JobStatus,
  PayType,
  ScoutLead,
  ScreeningQuestion,
} from "@/lib/types";

/**
 * Talent / hiring engine — job posts, the public application intake, and the
 * owner's candidate pipeline. Jobs are hosted publicly at /jobs/[slug]; the
 * workspace's open roles are listed at /careers/[careers_slug]. Applications
 * come in through a public form (like the Stripe checkout flow: the workspace is
 * resolved from the job's globally-unique slug), with the résumé in a private
 * bucket. Server-only.
 */

export const APPLICATION_STAGES: ApplicationStage[] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
];

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "job"
  );
}

async function uniqueJobSlug(base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 8; i++) {
    const candidate = `${root}-${randomUUID().slice(0, 6)}`;
    // tenant-scope-exempt: job slugs are globally unique (public /jobs/[slug] URLs).
    const [ex] = await db.select({ id: jobPosts.id }).from(jobPosts).where(eq(jobPosts.slug, candidate)).limit(1);
    if (!ex) return candidate;
  }
  return `${root}-${randomUUID().slice(0, 12)}`;
}

type JobRow = typeof jobPosts.$inferSelect;
type CandidateRow = typeof candidates.$inferSelect;
type ApplicationRow = typeof applications.$inferSelect;

function toJob(r: JobRow): JobPost {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    title: r.title,
    location: r.location,
    employment_type: r.employment_type,
    description_md: r.description_md,
    pay_type: r.pay_type,
    pay_min: r.pay_min,
    pay_max: r.pay_max,
    pay_currency: r.pay_currency,
    compliance_md: r.compliance_md,
    status: r.status,
    slug: r.slug,
    screening_questions: (r.screening_questions ?? []) as ScreeningQuestion[],
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/** Clamp a pay amount (integer cents) to a sane, non-negative range. */
function cleanCents(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n <= 0) return null;
  return Math.min(n, 2_000_000_000); // ~$20M ceiling, safely under int4 max
}

/** Normalize the compensation fields on an input before persisting. */
function cleanPay(input: {
  pay_type?: PayType;
  pay_min?: number | null;
  pay_max?: number | null;
  pay_currency?: string;
}): { pay_type: PayType; pay_min: number | null; pay_max: number | null; pay_currency: string } {
  const pay_type: PayType = input.pay_type ?? "unspecified";
  if (pay_type === "unspecified") {
    return { pay_type, pay_min: null, pay_max: null, pay_currency: (input.pay_currency || "usd").toLowerCase() };
  }
  let min = cleanCents(input.pay_min);
  let max = cleanCents(input.pay_max);
  if (min != null && max != null && max < min) [min, max] = [max, min];
  return { pay_type, pay_min: min, pay_max: max, pay_currency: (input.pay_currency || "usd").toLowerCase() };
}
function toCandidate(r: CandidateRow): Candidate {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    resume_path: r.resume_path,
    links: (r.links ?? []) as string[],
    source: r.source,
    created_at: iso(r.created_at),
  };
}
function toApplication(r: ApplicationRow, c?: CandidateRow | null, jobTitle?: string): Application {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    job_id: r.job_id,
    candidate_id: r.candidate_id,
    stage: r.stage,
    cover_note: r.cover_note,
    answers: (r.answers ?? []) as { question: string; answer: string }[],
    ai_score: r.ai_score,
    ai_summary: r.ai_summary,
    ai_recommend: r.ai_recommend,
    ai_eval: (r.ai_eval ?? { strengths: [], concerns: [] }) as ApplicationEval,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    candidate_name: c?.name,
    candidate_email: c?.email,
    candidate_phone: c?.phone ?? null,
    resume_path: c?.resume_path ?? null,
    job_title: jobTitle,
  };
}

/* --------------------------------- jobs ---------------------------------- */

export async function listJobs(workspaceId: string): Promise<JobPost[]> {
  const rows = await db
    .select()
    .from(jobPosts)
    .where(eq(jobPosts.workspace_id, workspaceId))
    .orderBy(desc(jobPosts.created_at));
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const apps = await db
    .select({ job_id: applications.job_id, stage: applications.stage })
    .from(applications)
    .where(and(eq(applications.workspace_id, workspaceId), inArray(applications.job_id, ids)));

  const total = new Map<string, number>();
  const active = new Map<string, number>();
  for (const a of apps) {
    total.set(a.job_id, (total.get(a.job_id) ?? 0) + 1);
    if (a.stage !== "rejected" && a.stage !== "hired") active.set(a.job_id, (active.get(a.job_id) ?? 0) + 1);
  }
  return rows.map((r) => ({ ...toJob(r), applicant_count: total.get(r.id) ?? 0, active_count: active.get(r.id) ?? 0 }));
}

export async function getJob(workspaceId: string, id: string): Promise<JobPost | null> {
  const [r] = await db
    .select()
    .from(jobPosts)
    .where(and(eq(jobPosts.workspace_id, workspaceId), eq(jobPosts.id, id)))
    .limit(1);
  return r ? toJob(r) : null;
}

export interface JobInput {
  title: string;
  location?: string;
  employment_type?: EmploymentType;
  description_md?: string;
  screening_questions?: ScreeningQuestion[];
  pay_type?: PayType;
  /** Integer cents (salary = annual, hourly = per-hour). */
  pay_min?: number | null;
  pay_max?: number | null;
  pay_currency?: string;
  compliance_md?: string;
}

export async function createJob(
  workspaceId: string,
  input: JobInput,
): Promise<{ ok: true; job: JobPost } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the role a title." };
  const id = uid();
  const now = new Date();
  const slug = await uniqueJobSlug(title);
  const pay = cleanPay(input);
  // Pre-fill the compliance block from the workspace default when not provided.
  const compliance =
    input.compliance_md !== undefined ? input.compliance_md : (await getWorkspaceCompliance(workspaceId)) ?? "";
  await db.insert(jobPosts).values({
    id,
    workspace_id: workspaceId,
    title: title.slice(0, 200),
    location: (input.location ?? "").slice(0, 120),
    employment_type: input.employment_type ?? "full_time",
    description_md: (input.description_md ?? "").slice(0, 12000),
    pay_type: pay.pay_type,
    pay_min: pay.pay_min,
    pay_max: pay.pay_max,
    pay_currency: pay.pay_currency,
    compliance_md: compliance.slice(0, 8000),
    status: "draft",
    slug,
    screening_questions: (input.screening_questions ?? []).slice(0, 8),
    created_at: now,
    updated_at: now,
  });
  const job = await getJob(workspaceId, id);
  return job ? { ok: true, job } : { ok: false, error: "Couldn't create the job." };
}

export async function updateJob(
  workspaceId: string,
  id: string,
  patch: Partial<JobInput>,
): Promise<{ ok: boolean; error?: string }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.title !== undefined) {
    if (!patch.title.trim()) return { ok: false, error: "Title can't be empty." };
    set.title = patch.title.trim().slice(0, 200);
  }
  if (patch.location !== undefined) set.location = patch.location.slice(0, 120);
  if (patch.employment_type !== undefined) set.employment_type = patch.employment_type;
  if (patch.description_md !== undefined) set.description_md = patch.description_md.slice(0, 12000);
  if (patch.screening_questions !== undefined) set.screening_questions = patch.screening_questions.slice(0, 8);
  if (patch.compliance_md !== undefined) set.compliance_md = patch.compliance_md.slice(0, 8000);
  if (patch.pay_type !== undefined) {
    const pay = cleanPay(patch);
    set.pay_type = pay.pay_type;
    set.pay_min = pay.pay_min;
    set.pay_max = pay.pay_max;
    set.pay_currency = pay.pay_currency;
  }
  await db.update(jobPosts).set(set).where(and(eq(jobPosts.workspace_id, workspaceId), eq(jobPosts.id, id)));
  return { ok: true };
}

/* ---------------------- workspace compliance default --------------------- */

export async function getWorkspaceCompliance(workspaceId: string): Promise<string | null> {
  const [ws] = await db
    .select({ compliance_md: workspaces.compliance_md })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return ws?.compliance_md ?? null;
}

export async function setWorkspaceCompliance(workspaceId: string, value: string): Promise<{ ok: boolean }> {
  await db
    .update(workspaces)
    .set({ compliance_md: value.slice(0, 8000) })
    .where(eq(workspaces.id, workspaceId));
  return { ok: true };
}

/** Publish (open) / close / revert-to-draft a job. Opening ensures the workspace
 *  has a public careers slug. */
export async function setJobStatus(
  workspaceId: string,
  id: string,
  status: JobStatus,
): Promise<{ ok: boolean; error?: string }> {
  if (status === "open") await ensureCareersSlug(workspaceId);
  await db
    .update(jobPosts)
    .set({ status, updated_at: new Date() })
    .where(and(eq(jobPosts.workspace_id, workspaceId), eq(jobPosts.id, id)));
  return { ok: true };
}

export async function deleteJob(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(jobPosts).where(and(eq(jobPosts.workspace_id, workspaceId), eq(jobPosts.id, id)));
  return { ok: true };
}

/** AI-draft a job description from the company brief (metered). */
export async function draftJob(
  workspaceId: string,
  input: { title: string; location?: string; employmentType?: EmploymentType; notes?: string },
): Promise<JobDraft> {
  const { brief } = await getPlanningContext(workspaceId);
  return runWithUsage(workspaceId, "job-description", () =>
    draftJobDescription({
      title: input.title,
      location: input.location,
      employmentType: input.employmentType,
      notes: input.notes,
      brief,
    }),
  );
}

/* --------------------------- careers board slug -------------------------- */

async function uniqueCareersSlug(base: string): Promise<string> {
  const root = slugify(base).slice(0, 32) || "careers";
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? root : `${root}-${randomUUID().slice(0, 4)}`;
    // tenant-scope-exempt: careers slugs are globally unique (public /careers/[slug]).
    const [ex] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.careers_slug, candidate))
      .limit(1);
    if (!ex) return candidate;
  }
  return `${root}-${randomUUID().slice(0, 8)}`;
}

/** Ensure the workspace has a public careers slug; returns it. */
export async function ensureCareersSlug(workspaceId: string): Promise<string> {
  const [ws] = await db
    .select({ name: workspaces.name, careers_slug: workspaces.careers_slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (ws?.careers_slug) return ws.careers_slug;
  const slug = await uniqueCareersSlug(ws?.name || "careers");
  await db.update(workspaces).set({ careers_slug: slug }).where(eq(workspaces.id, workspaceId));
  return slug;
}

export async function getCareersSlug(workspaceId: string): Promise<string | null> {
  const [ws] = await db
    .select({ careers_slug: workspaces.careers_slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return ws?.careers_slug ?? null;
}

/* ------------------------------ public reads ----------------------------- */

/** A single OPEN job by its public slug (the /jobs/[slug] renderer). */
export async function getPublishedJobBySlug(slug: string): Promise<JobPost | null> {
  // tenant-scope-exempt: public renderer; a job slug is globally unique and the
  // request carries no workspace context.
  const [r] = await db
    .select()
    .from(jobPosts)
    .where(and(eq(jobPosts.slug, slug), eq(jobPosts.status, "open")))
    .limit(1);
  return r ? toJob(r) : null;
}

/** The public careers board for a workspace: its name + open roles. */
export async function getCareersBoard(
  careersSlug: string,
): Promise<{ company: string; jobs: JobPost[] } | null> {
  // tenant-scope-exempt: public board lookup by a globally-unique careers slug.
  const [ws] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.careers_slug, careersSlug))
    .limit(1);
  if (!ws) return null;
  const rows = await db
    .select()
    .from(jobPosts)
    .where(and(eq(jobPosts.workspace_id, ws.id), eq(jobPosts.status, "open")))
    .orderBy(desc(jobPosts.created_at));
  return { company: ws.name, jobs: rows.map(toJob) };
}

/* --------------------------- application intake -------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ApplicationSubmission {
  jobSlug: string;
  name: string;
  email: string;
  phone?: string;
  coverNote?: string;
  links?: string[];
  answers?: { question: string; answer: string }[];
  resume?: { bytes: Buffer; mime: string; filename: string } | null;
}

/**
 * Public application intake. Resolves the workspace from the (open) job slug,
 * upserts the candidate by email, stores the résumé in the private bucket, and
 * creates/updates the application at the "applied" stage.
 */
export async function submitApplication(
  input: ApplicationSubmission,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const phone = (input.phone ?? "").trim();
  const links = (input.links ?? []).map((l) => l.trim()).filter(Boolean);
  if (!name) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!phone) return { ok: false, error: "Enter a phone number." };
  if (links.length === 0) return { ok: false, error: "Add at least one link (portfolio or LinkedIn)." };

  const job = await getPublishedJobBySlug(input.jobSlug);
  if (!job) return { ok: false, error: "This role isn't accepting applications right now." };
  const ws = job.workspace_id;

  // Résumé → private bucket (optional but strongly encouraged by the form).
  let resumePath: string | null = null;
  if (input.resume && input.resume.bytes.length > 0) {
    try {
      const { path } = await uploadResumeBytes(ws, uid(), input.resume.bytes, input.resume.mime, input.resume.filename);
      resumePath = path;
    } catch {
      return { ok: false, error: "We couldn't upload that résumé — try a PDF under 10MB." };
    }
  }

  // Upsert the candidate by (workspace, email).
  const [existing] = await db
    .select()
    .from(candidates)
    .where(and(eq(candidates.workspace_id, ws), eq(candidates.email, email)))
    .limit(1);

  let candidateId: string;
  if (existing) {
    candidateId = existing.id;
    await db
      .update(candidates)
      .set({
        name: name.slice(0, 200),
        phone: phone.slice(0, 40),
        resume_path: resumePath ?? existing.resume_path,
        links: links.slice(0, 10),
      })
      .where(and(eq(candidates.workspace_id, ws), eq(candidates.id, existing.id)));
  } else {
    candidateId = uid();
    await db.insert(candidates).values({
      id: candidateId,
      workspace_id: ws,
      name: name.slice(0, 200),
      email,
      phone: phone.slice(0, 40),
      resume_path: resumePath,
      links: links.slice(0, 10),
      source: "applied",
      created_at: new Date(),
    });
  }

  // One application per (job, candidate) — re-applying refreshes it.
  const [prior] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(eq(applications.workspace_id, ws), eq(applications.job_id, job.id), eq(applications.candidate_id, candidateId)),
    )
    .limit(1);

  const answers = (input.answers ?? []).filter((a) => a.answer.trim()).slice(0, 12);
  const coverNote = (input.coverNote ?? "").trim().slice(0, 4000);
  if (prior) {
    await db
      .update(applications)
      .set({ cover_note: coverNote, answers, updated_at: new Date() })
      .where(and(eq(applications.workspace_id, ws), eq(applications.id, prior.id)));
  } else {
    await db.insert(applications).values({
      id: uid(),
      workspace_id: ws,
      job_id: job.id,
      candidate_id: candidateId,
      stage: "applied",
      cover_note: coverNote,
      answers,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
  return { ok: true };
}

/* ------------------------------- pipeline -------------------------------- */

/** Every application to a job, with the candidate fields the pipeline UI needs. */
export async function listApplications(workspaceId: string, jobId: string): Promise<Application[]> {
  const [job] = await db
    .select({ title: jobPosts.title })
    .from(jobPosts)
    .where(and(eq(jobPosts.workspace_id, workspaceId), eq(jobPosts.id, jobId)))
    .limit(1);
  if (!job) return [];
  const rows = await db
    .select({ a: applications, c: candidates })
    .from(applications)
    .leftJoin(candidates, eq(applications.candidate_id, candidates.id))
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.job_id, jobId)))
    .orderBy(desc(applications.created_at));
  return rows.map((r) => toApplication(r.a, r.c, job.title));
}

export async function moveApplicationStage(
  workspaceId: string,
  applicationId: string,
  stage: ApplicationStage,
): Promise<{ ok: boolean }> {
  await db
    .update(applications)
    .set({ stage, updated_at: new Date() })
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.id, applicationId)));
  return { ok: true };
}

/* -------------------------------- scout ---------------------------------- */

/**
 * Source candidate leads for a role via live web research (Tavily) distilled by
 * the AI into real named people found in the results. Suggestions only — nothing
 * is persisted; the owner reviews and reaches out.
 */
export async function scoutForJob(
  workspaceId: string,
  jobId: string,
  keywords?: string,
): Promise<{ ok: true; leads: ScoutLead[]; configured: boolean } | { ok: false; error: string }> {
  const job = await getJob(workspaceId, jobId);
  if (!job) return { ok: false, error: "Job not found." };
  if (!tavilyConfigured()) return { ok: true, leads: [], configured: false };
  const { brief } = await getPlanningContext(workspaceId);
  const query = [job.title, job.location, keywords, "candidate OR profile OR LinkedIn"].filter(Boolean).join(" ");
  const results = await tavilySearch(query, { maxResults: 10, searchDepth: "advanced" });
  if (!results.length) return { ok: true, leads: [], configured: true };
  try {
    const leads = await runWithUsage(workspaceId, "talent-scout", () =>
      scoutCandidates({ job: { title: job.title, description_md: job.description_md }, brief, results }),
    );
    return { ok: true, leads, configured: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Scouting failed." };
  }
}

/** Draft a warm recruiting-outreach message for a sourced lead (to copy/send). */
export async function draftScoutOutreach(
  workspaceId: string,
  jobId: string,
  lead: { name: string; headline: string },
  senderName: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const job = await getJob(workspaceId, jobId);
  if (!job) return { ok: false, error: "Job not found." };
  const { brief } = await getPlanningContext(workspaceId);
  try {
    const r = await runWithUsage(workspaceId, "talent-outreach", () =>
      draftOutreach({ job: { title: job.title }, lead, brief, senderName }),
    );
    return { ok: true, message: r.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft outreach." };
  }
}

/** A short-lived signed URL to view an application's candidate résumé. */
export async function getApplicationResumeUrl(
  workspaceId: string,
  applicationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ resume_path: candidates.resume_path })
    .from(applications)
    .leftJoin(candidates, eq(applications.candidate_id, candidates.id))
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.id, applicationId)))
    .limit(1);
  if (!row?.resume_path) return null;
  return resumeSignedUrl(row.resume_path);
}

/* ------------------------------ AI screening ----------------------------- */

/**
 * Screen one application against its job — an AI fit score (0-100) + summary +
 * strengths/concerns + a recommend-for-interview flag, from the JD, the
 * candidate's cover note + screening answers, and their résumé text (read from
 * the private bucket). Advisory only: it NEVER changes the stage.
 */
export async function screenApplication(
  workspaceId: string,
  applicationId: string,
): Promise<{ ok: true; result: ScreenResult } | { ok: false; error: string }> {
  const [row] = await db
    .select({ a: applications, c: candidates, j: jobPosts })
    .from(applications)
    .leftJoin(candidates, eq(applications.candidate_id, candidates.id))
    .leftJoin(jobPosts, eq(applications.job_id, jobPosts.id))
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.id, applicationId)))
    .limit(1);
  if (!row || !row.j) return { ok: false, error: "Application not found." };

  let resumeText = "";
  if (row.c?.resume_path) {
    const dl = await downloadResumeBytes(row.c.resume_path);
    if (dl) {
      try {
        resumeText = await extractDocText(row.c.resume_path, dl.mime, dl.bytes);
      } catch {
        resumeText = "";
      }
    }
  }

  const { brief } = await getPlanningContext(workspaceId);
  let result: ScreenResult;
  try {
    result = await runWithUsage(workspaceId, "talent-screen", () =>
      screenCandidate({
        job: {
          title: row.j!.title,
          description_md: row.j!.description_md,
          screening_questions: (row.j!.screening_questions ?? []) as { prompt: string }[],
        },
        application: {
          cover_note: row.a.cover_note,
          answers: (row.a.answers ?? []) as { question: string; answer: string }[],
        },
        resumeText,
        brief,
      }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Screening failed." };
  }

  await db
    .update(applications)
    .set({
      ai_score: result.score,
      ai_summary: result.summary,
      ai_recommend: result.recommend,
      ai_eval: { strengths: result.strengths, concerns: result.concerns } as ApplicationEval,
      updated_at: new Date(),
    })
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.id, applicationId)));
  return { ok: true, result };
}

/**
 * Draft a candidate-facing email (rejection or interview invite) and stage it in
 * the Email Manager for the owner to review and send. Never auto-sends; never
 * changes the application's stage.
 */
export async function draftCandidateEmail(
  workspaceId: string,
  applicationId: string,
  kind: HiringEmailKind,
  senderName: string,
  scopeUserId: string | null,
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  const [row] = await db
    .select({ a: applications, c: candidates, j: jobPosts })
    .from(applications)
    .leftJoin(candidates, eq(applications.candidate_id, candidates.id))
    .leftJoin(jobPosts, eq(applications.job_id, jobPosts.id))
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.id, applicationId)))
    .limit(1);
  if (!row || !row.j || !row.c) return { ok: false, error: "Application not found." };
  if (!row.c.email) return { ok: false, error: "No email on file for this candidate." };

  const { brief } = await getPlanningContext(workspaceId);
  let draft: { subject: string; body: string };
  try {
    draft = await runWithUsage(workspaceId, "talent-email", () =>
      draftHiringEmail({ kind, job: { title: row.j!.title }, candidateName: row.c!.name, senderName, brief }),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't draft the email." };
  }

  const staged = await stageOutboundDraft(
    workspaceId,
    {
      to: row.c.email,
      subject: draft.subject,
      body: draft.body,
      recipientName: row.c.name,
      intent: `${kind === "rejection" ? "Rejection" : "Interview invite"} — ${row.j.title}`,
    },
    scopeUserId,
  );
  return { ok: true, draftId: staged.draft.id };
}

/**
 * Schedule an interview: create a Google Calendar event that invites the
 * candidate (Google emails them the invite), plus a Zoom meeting when Zoom is
 * connected, and move the application to the interview stage. Requires Google
 * Calendar connected (HTTPS OAuth — connect from the deployed app, not localhost).
 */
export async function scheduleInterview(
  workspaceId: string,
  applicationId: string,
  input: { whenISO: string; durationMin?: number },
): Promise<{ ok: true; joinUrl: string | null } | { ok: false; error: string }> {
  const when = new Date(input.whenISO);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Pick a valid date and time." };
  if (when.getTime() < Date.now() - 60_000) return { ok: false, error: "Pick a time in the future." };
  const dur = Math.min(Math.max(input.durationMin ?? 30, 15), 180);

  const [row] = await db
    .select({ a: applications, c: candidates, j: jobPosts })
    .from(applications)
    .leftJoin(candidates, eq(applications.candidate_id, candidates.id))
    .leftJoin(jobPosts, eq(applications.job_id, jobPosts.id))
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.id, applicationId)))
    .limit(1);
  if (!row || !row.j || !row.c) return { ok: false, error: "Application not found." };
  if (!row.c.email) return { ok: false, error: "No email on file for this candidate." };

  const calToken = await getValidAccessToken(workspaceId, "Google Calendar");
  if (!calToken) return { ok: false, error: "Connect Google Calendar in Integrations to schedule interviews." };

  const topic = `Interview: ${row.c.name} — ${row.j.title}`;
  let joinUrl: string | null = null;
  const zoomToken = await getValidAccessToken(workspaceId, "Zoom");
  if (zoomToken) {
    try {
      const m = await createZoomMeeting(zoomToken, { topic, startTime: when.toISOString(), durationMin: dur });
      joinUrl = m.join_url || null;
    } catch {
      joinUrl = null;
    }
  }

  const startISO = when.toISOString();
  const endISO = new Date(when.getTime() + dur * 60_000).toISOString();
  try {
    await createCalendarEvent(calToken, {
      summary: topic,
      description: `Interview for the ${row.j.title} role.${joinUrl ? `\n\nJoin: ${joinUrl}` : ""}`,
      startISO,
      endISO,
      attendees: [row.c.email],
      location: joinUrl ?? undefined,
      sendUpdates: "all",
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create the calendar event." };
  }

  await db
    .update(applications)
    .set({ stage: "interview", updated_at: new Date() })
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.id, applicationId)));
  return { ok: true, joinUrl };
}

/** Screen every application (or only the unscored ones) for a job. Bounded per run. */
export async function screenJobApplicants(
  workspaceId: string,
  jobId: string,
  opts: { onlyUnscored?: boolean } = {},
): Promise<{ screened: number }> {
  const rows = await db
    .select({ id: applications.id, ai_score: applications.ai_score })
    .from(applications)
    .where(and(eq(applications.workspace_id, workspaceId), eq(applications.job_id, jobId)))
    .orderBy(desc(applications.created_at));
  const targets = rows.filter((r) => (opts.onlyUnscored ? r.ai_score == null : true)).slice(0, 30);
  let screened = 0;
  for (const t of targets) {
    const r = await screenApplication(workspaceId, t.id);
    if (r.ok) screened++;
  }
  return { screened };
}
