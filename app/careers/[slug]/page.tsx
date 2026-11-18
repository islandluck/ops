import Link from "next/link";
import { notFound } from "next/navigation";
import { getCareersBoard } from "@/lib/talent";
import { formatPay } from "@/lib/talent/format";
import type { EmploymentType } from "@/lib/types";

export const dynamic = "force-dynamic";

const EMPLOYMENT_LABEL: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
};

export default async function CareersBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const board = await getCareersBoard(slug);
  if (!board) notFound();

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <header>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-400">Careers</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Open roles at {board.company}</h1>
        </header>

        {board.jobs.length === 0 ? (
          <p className="mt-10 text-slate-500">No open roles right now — check back soon.</p>
        ) : (
          <ul className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
            {board.jobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.slug}`} className="group flex items-center justify-between gap-4 py-5">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-slate-900 group-hover:underline">{job.title}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {[job.location, EMPLOYMENT_LABEL[job.employment_type], formatPay(job)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-slate-400 group-hover:text-slate-900">
                    View &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
