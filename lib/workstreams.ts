import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, projectWorkstreams } from "@/lib/db/schema";
import { createQuoteRequest, draftAllRfqs, sourceSuppliers } from "@/lib/quotes";
import { createOutreachCampaign, draftAllOutreach, sourceContacts } from "@/lib/outreach";
import { researchTopics } from "@/lib/ai/research";
import { proposeWorkstreamApproach } from "@/lib/ai/workstreams";
import { WORKSPACE_PROJECT_KIND } from "@/lib/types";
import type { ProjectWorkstream, WorkstreamDelegateKind, WorkstreamStatus } from "@/lib/types";

/**
 * Owner-led projects: the founder drives a project and authors parallel workstreams
 * (directions they're weighing). Each can be handed to the Executive, which proposes
 * an approach (propose-first), then on approval runs a read-only accelerator — research,
 * quote sourcing, or cold outreach — and writes findings back onto the branch. Drafts
 * land in the Email Manager; nothing auto-sends. Server-only.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();

type Row = typeof projectWorkstreams.$inferSelect;

function toWorkstream(r: Row): ProjectWorkstream {
  return {
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    notes: r.notes,
    status: r.status,
    position: r.position,
    delegate_kind: r.delegate_kind ?? null,
    proposal: r.proposal ?? null,
    delegate_ref_type: r.delegate_ref_type ?? null,
    delegate_ref_id: r.delegate_ref_id ?? null,
    findings: r.findings,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/* ------------------------------- projects -------------------------------- */

/** Start an owner-led project — the founder drives it; no agent plan is authored. */
export async function createWorkspaceProject(
  workspaceId: string,
  input: { title: string; goal?: string },
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the project a name first." };
  const id = uid();
  const now = new Date();
  await db.insert(projects).values({
    id,
    workspace_id: workspaceId,
    goal: (input.goal ?? title).trim().slice(0, 2000),
    title: title.slice(0, 300),
    summary: "",
    status: "active",
    owner_kind: "manager",
    owner_agent_id: null,
    kind: WORKSPACE_PROJECT_KIND,
    plan: { phases: [] },
    current_phase: 0,
    created_by_type: "human",
    created_at: now,
    updated_at: now,
  });
  return { ok: true, projectId: id };
}

/** Close an owner-led project, recording the chosen direction + outcome. */
export async function closeWorkspaceProject(
  workspaceId: string,
  projectId: string,
  input: { chosenWorkstreamId?: string; outcome?: string },
): Promise<{ ok: boolean }> {
  if (input.chosenWorkstreamId) {
    await db
      .update(projectWorkstreams)
      .set({ status: "chosen", updated_at: new Date() })
      .where(
        and(
          eq(projectWorkstreams.workspace_id, workspaceId),
          eq(projectWorkstreams.id, input.chosenWorkstreamId),
          eq(projectWorkstreams.project_id, projectId),
        ),
      );
  }
  await db
    .update(projects)
    .set({
      status: "done",
      ...(input.outcome ? { summary: input.outcome.slice(0, 2000) } : {}),
      updated_at: new Date(),
    })
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)));
  return { ok: true };
}

/* ------------------------------ workstreams ------------------------------ */

export async function listWorkstreams(workspaceId: string, projectId: string): Promise<ProjectWorkstream[]> {
  const rows = await db
    .select()
    .from(projectWorkstreams)
    .where(and(eq(projectWorkstreams.workspace_id, workspaceId), eq(projectWorkstreams.project_id, projectId)))
    .orderBy(asc(projectWorkstreams.position), asc(projectWorkstreams.created_at));
  return rows.map(toWorkstream);
}

export async function getWorkstream(workspaceId: string, id: string): Promise<ProjectWorkstream | null> {
  const [row] = await db
    .select()
    .from(projectWorkstreams)
    .where(and(eq(projectWorkstreams.workspace_id, workspaceId), eq(projectWorkstreams.id, id)))
    .limit(1);
  return row ? toWorkstream(row) : null;
}

/** Add a direction to an owner-led project. */
export async function addWorkstream(
  workspaceId: string,
  projectId: string,
  input: { title: string; notes?: string },
): Promise<{ ok: true; workstream: ProjectWorkstream } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Name the direction first." };
  // Tenancy + existence check: the project must live in this workspace.
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  if (!proj) return { ok: false, error: "Project not found." };
  const agg = await db
    .select({ maxPos: sql<number>`coalesce(max(${projectWorkstreams.position}), -1)` })
    .from(projectWorkstreams)
    .where(and(eq(projectWorkstreams.workspace_id, workspaceId), eq(projectWorkstreams.project_id, projectId)));
  const nextPos = (agg[0]?.maxPos ?? -1) + 1;
  const id = uid();
  const now = new Date();
  await db.insert(projectWorkstreams).values({
    id,
    workspace_id: workspaceId,
    project_id: projectId,
    title: title.slice(0, 300),
    notes: (input.notes ?? "").slice(0, 4000),
    status: "open",
    position: nextPos,
    findings: "",
    created_at: now,
    updated_at: now,
  });
  const ws = await getWorkstream(workspaceId, id);
  return ws ? { ok: true, workstream: ws } : { ok: false, error: "Couldn't create the workstream." };
}

export async function updateWorkstream(
  workspaceId: string,
  id: string,
  patch: { title?: string; notes?: string; status?: WorkstreamStatus },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 300);
  if (patch.notes !== undefined) set.notes = patch.notes.slice(0, 4000);
  if (patch.status !== undefined) set.status = patch.status;
  await db
    .update(projectWorkstreams)
    .set(set)
    .where(and(eq(projectWorkstreams.workspace_id, workspaceId), eq(projectWorkstreams.id, id)));
  return { ok: true };
}

export async function deleteWorkstream(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .delete(projectWorkstreams)
    .where(and(eq(projectWorkstreams.workspace_id, workspaceId), eq(projectWorkstreams.id, id)));
  return { ok: true };
}

/* ------------------------------ delegation ------------------------------- */

/** Ask the Executive to propose an approach for a workstream (propose-first). Stores
 *  the plan + params on the branch; nothing is sourced or drafted until approved. */
export async function proposeWorkstream(
  workspaceId: string,
  id: string,
  kind: WorkstreamDelegateKind,
): Promise<{ ok: true; workstream: ProjectWorkstream } | { ok: false; error: string }> {
  const ws = await getWorkstream(workspaceId, id);
  if (!ws) return { ok: false, error: "Workstream not found." };
  const [proj] = await db
    .select({ title: projects.title, goal: projects.goal })
    .from(projects)
    .where(and(eq(projects.workspace_id, workspaceId), eq(projects.id, ws.project_id)))
    .limit(1);
  const proposal = await proposeWorkstreamApproach({
    projectTitle: proj?.title ?? "",
    projectGoal: proj?.goal ?? "",
    workstreamTitle: ws.title,
    workstreamNotes: ws.notes,
    kind,
  });
  await db
    .update(projectWorkstreams)
    .set({ delegate_kind: kind, proposal, status: "proposed", updated_at: new Date() })
    .where(and(eq(projectWorkstreams.workspace_id, workspaceId), eq(projectWorkstreams.id, id)));
  const updated = await getWorkstream(workspaceId, id);
  return updated ? { ok: true, workstream: updated } : { ok: false, error: "Couldn't save the proposal." };
}

/** Discard a pending proposal — back to the owner driving the branch. */
export async function cancelProposal(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db
    .update(projectWorkstreams)
    .set({ proposal: null, delegate_kind: null, status: "open", updated_at: new Date() })
    .where(and(eq(projectWorkstreams.workspace_id, workspaceId), eq(projectWorkstreams.id, id)));
  return { ok: true };
}

async function writeFindings(
  workspaceId: string,
  id: string,
  input: {
    status: WorkstreamStatus;
    findings: string;
    ref?: { type: "quote_request" | "outreach_campaign"; id: string };
  },
): Promise<void> {
  await db
    .update(projectWorkstreams)
    .set({
      status: input.status,
      findings: input.findings.slice(0, 8000),
      ...(input.ref ? { delegate_ref_type: input.ref.type, delegate_ref_id: input.ref.id } : {}),
      proposal: null,
      updated_at: new Date(),
    })
    .where(and(eq(projectWorkstreams.workspace_id, workspaceId), eq(projectWorkstreams.id, id)));
}

/** Approve a proposal and run it — the Executive sources/drafts/researches and writes
 *  findings back onto the branch. Nothing sends; drafts land in the Email Manager. */
export async function runWorkstream(
  workspaceId: string,
  id: string,
): Promise<{ ok: true; summary: string; href?: string } | { ok: false; error: string }> {
  const ws = await getWorkstream(workspaceId, id);
  if (!ws) return { ok: false, error: "Workstream not found." };
  const p = ws.proposal;
  if (!p) return { ok: false, error: "Propose an approach first." };
  try {
    if (p.kind === "research") {
      const query = (p.query || ws.title).trim();
      const res = await researchTopics(query);
      if (!res) {
        const note = "Live web research isn't set up (no TAVILY_API_KEY) — add the key to enable research handoffs.";
        await writeFindings(workspaceId, id, { status: "open", findings: note });
        return { ok: false, error: note };
      }
      const srcs = res.sources
        .slice(0, 3)
        .map((s) => `• ${s.title} — ${s.url}`)
        .join("\n");
      const findings = `${res.answer}${srcs ? `\n\nSources:\n${srcs}` : ""}`.slice(0, 8000);
      await writeFindings(workspaceId, id, { status: "answered", findings });
      return { ok: true, summary: "Research is back — see the findings on this branch." };
    }

    if (p.kind === "quotes") {
      const created = await createQuoteRequest(workspaceId, {
        title: p.title || ws.title,
        spec: p.spec || ws.notes,
        target_count: p.target_count ?? 5,
      });
      if (!created.ok) return { ok: false, error: created.error };
      const reqId = created.request.id;
      const sourced = await sourceSuppliers(workspaceId, reqId);
      if (!sourced.ok) {
        await writeFindings(workspaceId, id, {
          status: "delegated",
          findings: `Quote request opened, but sourcing failed: ${sourced.error}`,
          ref: { type: "quote_request", id: reqId },
        });
        return { ok: false, error: sourced.error };
      }
      let findings: string;
      if (!sourced.configured) {
        findings =
          "Quote request opened. Live sourcing isn't set up (no TAVILY_API_KEY) — add suppliers manually on the Quotes page.";
      } else {
        const drafted = await draftAllRfqs(workspaceId, reqId, "", null);
        findings = `Sourced ${sourced.added} supplier${sourced.added === 1 ? "" : "s"} and drafted ${drafted.drafted} RFQ email${drafted.drafted === 1 ? "" : "s"} in the Email Manager to review + send. Track quotes on the Quotes page.`;
      }
      await writeFindings(workspaceId, id, {
        status: "delegated",
        findings,
        ref: { type: "quote_request", id: reqId },
      });
      return { ok: true, summary: findings, href: `/quotes?open=${reqId}` };
    }

    // outreach
    const created = await createOutreachCampaign(workspaceId, {
      title: p.title || ws.title,
      description: p.description || ws.notes,
      target_roles: p.target_roles || "",
      target_count: p.target_count ?? 5,
    });
    if (!created.ok) return { ok: false, error: created.error };
    const campId = created.campaign.id;
    const sourced = await sourceContacts(workspaceId, campId);
    if (!sourced.ok) {
      await writeFindings(workspaceId, id, {
        status: "delegated",
        findings: `Campaign opened, but sourcing failed: ${sourced.error}`,
        ref: { type: "outreach_campaign", id: campId },
      });
      return { ok: false, error: sourced.error };
    }
    let findings: string;
    if (!sourced.configured) {
      findings = "Outreach campaign opened. Live sourcing isn't set up — add contacts manually on the Outreach page.";
    } else {
      const drafted = await draftAllOutreach(workspaceId, campId, "", null);
      findings = `Found ${sourced.added} contact${sourced.added === 1 ? "" : "s"} and drafted ${drafted.drafted} outreach email${drafted.drafted === 1 ? "" : "s"} in the Email Manager to review + send. Track replies on the Outreach page.`;
    }
    await writeFindings(workspaceId, id, {
      status: "delegated",
      findings,
      ref: { type: "outreach_campaign", id: campId },
    });
    return { ok: true, summary: findings, href: `/outreach?open=${campId}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't run the handoff." };
  }
}
