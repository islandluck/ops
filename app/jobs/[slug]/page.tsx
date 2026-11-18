import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getPublishedJobBySlug } from "@/lib/talent";
import { formatPay } from "@/lib/talent/format";
import { markdownToHtml } from "@/lib/content/format";
import type { EmploymentType } from "@/lib/types";

export const dynamic = "force-dynamic";

const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
};

export default async function PublicJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const job = await getPublishedJobBySlug(slug);
  if (!job) notFound();

  const applied = sp.applied === "1";
  const error = typeof sp.error === "string" ? sp.error : null;
  const bodyHtml = markdownToHtml(job.description_md || "");
  const pay = formatPay(job);
  const complianceHtml = job.compliance_md.trim() ? markdownToHtml(job.compliance_md) : "";

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">{job.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            {job.location && <span>{job.location}</span>}
            {job.location && <span aria-hidden>·</span>}
            <span>{EMPLOYMENT_LABEL[job.employment_type]}</span>
            {pay && (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[13px] font-medium text-slate-700">
                {pay}
              </span>
            )}
          </div>
        </header>

        {applied ? (
          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <p className="text-lg font-semibold text-emerald-900">Application received 🎉</p>
            <p className="mt-1 text-sm text-emerald-800">
              Thanks for applying to {job.title}. We&apos;ll be in touch if there&apos;s a fit.
            </p>
          </div>
        ) : (
          <>
            {error && <ErrorBanner error={error} />}
            <article
              className="prose-article mt-8 text-[15px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
            {complianceHtml && (
              <section
                className="prose-article mt-10 border-t border-slate-200 pt-6 text-[13px] leading-relaxed text-slate-500"
                dangerouslySetInnerHTML={{ __html: complianceHtml }}
              />
            )}
            <ApplySection slug={job.slug} questions={job.screening_questions} />
          </>
        )}
      </div>
    </main>
  );
}

function ErrorBanner({ error }: { error: string }) {
  const msg =
    error === "resume-required"
      ? "Please attach your résumé."
      : error === "resume-too-big"
        ? "That résumé is too large — keep it under 10MB."
        : error === "resume-type"
          ? "Please upload a PDF, Word doc, or text file."
          : error === "apply-failed"
            ? "Something went wrong submitting your application — please try again."
            : error;
  return (
    <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{msg}</div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {hint && <span className="ml-1 text-xs text-slate-400">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900";

function ApplySection({
  slug,
  questions,
}: {
  slug: string;
  questions: { id: string; prompt: string; required: boolean }[];
}) {
  return (
    <section className="mt-10 border-t border-slate-200 pt-8">
      <h2 className="text-xl font-semibold text-slate-900">Apply for this role</h2>
      <form action="/api/apply" method="post" encType="multipart/form-data" className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="job" value={slug} />
        {/* Honeypot — hidden from humans; bots fill it and get dropped. */}
        <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input name="name" required className={inputCls} />
          </Field>
          <Field label="Email">
            <input type="email" name="email" required className={inputCls} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            <input name="phone" required className={inputCls} />
          </Field>
          <Field label="Links" hint="(portfolio, LinkedIn — comma separated)">
            <input name="links" required className={inputCls} />
          </Field>
        </div>

        <Field label="Résumé" hint="PDF, Word, or text — up to 10MB">
          <input
            type="file"
            name="resume"
            required
            accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
          />
        </Field>

        <Field label="Why are you a fit?" hint="(optional)">
          <textarea name="cover_note" rows={4} className={inputCls} />
        </Field>

        {questions.map((q, i) => (
          <div key={q.id || i}>
            <input type="hidden" name={`qprompt_${i}`} value={q.prompt} />
            <Field label={q.prompt} hint={q.required ? undefined : "(optional)"}>
              <textarea name={`qanswer_${i}`} rows={3} required={q.required} className={inputCls} />
            </Field>
          </div>
        ))}

        <button
          type="submit"
          className="mt-2 inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Submit application
        </button>
        <p className="text-xs text-slate-400">
          Your details go to the hiring team for this role only.
        </p>
      </form>
    </section>
  );
}
