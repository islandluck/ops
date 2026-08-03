import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, pages, products } from "@/lib/db/schema";
import { getPlanningContext } from "@/lib/db/queries";
import { generatePageContent } from "@/lib/ai/page";
import type { Order, Page, PageContent, PageStatus, PageType, Product } from "@/lib/types";

/**
 * Pages + commerce engine — create/generate/publish pages (a page with a buy
 * button), plus the products they sell and the orders that come through Stripe.
 * Server-only. The public renderer at /p/[slug] reads via getPublishedPageBySlug.
 */

const uid = () => randomUUID();
const iso = (d: Date) => new Date(d).toISOString();

export function formatPrice(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
      cents / 100,
    );
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "page"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 8; i++) {
    const candidate = `${root}-${randomUUID().slice(0, 6)}`;
    // tenant-scope-exempt: slugs are globally unique across workspaces (public /p/[slug] URLs).
    const [ex] = await db.select({ id: pages.id }).from(pages).where(eq(pages.slug, candidate)).limit(1);
    if (!ex) return candidate;
  }
  return `${root}-${randomUUID().slice(0, 12)}`;
}

type PageRow = typeof pages.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

function toPage(r: PageRow): Page {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    project_id: r.project_id,
    product_id: r.product_id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    page_type: r.page_type,
    content: r.content,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    description: r.description,
    price_cents: r.price_cents,
    currency: r.currency,
  };
}
function toOrder(r: OrderRow): Order {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    page_id: r.page_id,
    product_id: r.product_id,
    status: r.status,
    amount_cents: r.amount_cents,
    currency: r.currency,
    customer_email: r.customer_email,
    created_at: iso(r.created_at),
  };
}

/* -------------------------------- pages ---------------------------------- */

export async function generateAndSavePage(
  workspaceId: string,
  input: {
    offer: string;
    pageType?: PageType;
    productId?: string | null;
    projectId?: string | null;
    agentId?: string | null;
  },
): Promise<{ ok: boolean; page?: Page; error?: string }> {
  const { brief } = await getPlanningContext(workspaceId);
  const pageType = input.pageType ?? "landing";

  let productName: string | undefined;
  let priceLabel: string | undefined;
  if (input.productId) {
    const [p] = await db
      .select()
      .from(products)
      .where(and(eq(products.workspace_id, workspaceId), eq(products.id, input.productId)))
      .limit(1);
    if (p) {
      productName = p.name;
      priceLabel = formatPrice(p.price_cents, p.currency);
    }
  }

  let gen;
  try {
    gen = await generatePageContent({ brief, offer: input.offer, pageType, productName, priceLabel });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Page generation failed." };
  }

  const id = uid();
  const now = new Date();
  const slug = await uniqueSlug(gen.title || input.offer);
  await db.insert(pages).values({
    id,
    workspace_id: workspaceId,
    project_id: input.projectId ?? null,
    product_id: input.productId ?? null,
    slug,
    title: gen.title,
    status: "draft",
    page_type: pageType,
    content: gen.content,
    created_by_type: input.agentId ? "agent" : "human",
    agent_id: input.agentId ?? null,
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
  return { ok: true, page: toPage(row) };
}

/** Create a hosted ARTICLE page (content-engine blog post) — rendered by PageView's
 *  article branch (no buy button). Returns the page + its public URL. */
export async function createHostedPost(
  workspaceId: string,
  input: {
    title: string;
    dek: string;
    bodyHtml: string;
    heroImageUrl?: string | null;
    projectId?: string | null;
    publish?: boolean;
  },
): Promise<Page> {
  const id = uid();
  const now = new Date();
  const slug = await uniqueSlug(input.title || "post");
  const content: PageContent = {
    headline: input.title,
    subheadline: input.dek,
    cta_label: "",
    sections: [],
    body_html: input.bodyHtml,
    hero_image_url: input.heroImageUrl || undefined,
  };
  await db.insert(pages).values({
    id,
    workspace_id: workspaceId,
    project_id: input.projectId ?? null,
    product_id: null,
    slug,
    title: (input.title || "Post").slice(0, 200),
    status: input.publish ? "published" : "draft",
    page_type: "blog",
    content,
    created_by_type: "agent",
    agent_id: null,
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
  return toPage(row);
}

export async function listPages(workspaceId: string): Promise<Page[]> {
  const rows = await db
    .select()
    .from(pages)
    .where(eq(pages.workspace_id, workspaceId))
    .orderBy(desc(pages.created_at));
  return rows.map(toPage);
}

export async function getPage(workspaceId: string, id: string): Promise<Page | null> {
  const [r] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspace_id, workspaceId), eq(pages.id, id)))
    .limit(1);
  return r ? toPage(r) : null;
}

/** Public read — only returns PUBLISHED pages (used by the /p/[slug] renderer). */
export async function getPublishedPageBySlug(slug: string): Promise<Page | null> {
  // tenant-scope-exempt: public renderer looks up a page by its globally-unique
  // slug; a public request carries no workspace context.
  const [r] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.status, "published")))
    .limit(1);
  return r ? toPage(r) : null;
}

export async function setPageStatus(
  workspaceId: string,
  id: string,
  status: PageStatus,
): Promise<{ ok: boolean }> {
  await db
    .update(pages)
    .set({ status, updated_at: new Date() })
    .where(and(eq(pages.workspace_id, workspaceId), eq(pages.id, id)));
  return { ok: true };
}

export async function updatePage(
  workspaceId: string,
  id: string,
  patch: { title?: string; content?: PageContent; product_id?: string | null },
): Promise<{ ok: boolean }> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.title !== undefined) set.title = patch.title.slice(0, 200);
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.product_id !== undefined) set.product_id = patch.product_id;
  await db.update(pages).set(set).where(and(eq(pages.workspace_id, workspaceId), eq(pages.id, id)));
  return { ok: true };
}

export async function deletePage(workspaceId: string, id: string): Promise<{ ok: boolean }> {
  await db.delete(pages).where(and(eq(pages.workspace_id, workspaceId), eq(pages.id, id)));
  return { ok: true };
}

/* ------------------------------- products -------------------------------- */

export async function createProduct(
  workspaceId: string,
  input: { name: string; description?: string; price_cents: number; currency?: string },
): Promise<Product> {
  const id = uid();
  const now = new Date();
  await db.insert(products).values({
    id,
    workspace_id: workspaceId,
    name: input.name.slice(0, 200),
    description: (input.description ?? "").slice(0, 1000),
    price_cents: Math.max(0, Math.round(input.price_cents)),
    currency: (input.currency ?? "usd").toLowerCase(),
    created_at: now,
    updated_at: now,
  });
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return toProduct(row);
}

export async function listProducts(workspaceId: string): Promise<Product[]> {
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.workspace_id, workspaceId))
    .orderBy(desc(products.created_at));
  return rows.map(toProduct);
}

export async function getProduct(workspaceId: string, id: string): Promise<Product | null> {
  const [r] = await db
    .select()
    .from(products)
    .where(and(eq(products.workspace_id, workspaceId), eq(products.id, id)))
    .limit(1);
  return r ? toProduct(r) : null;
}

/* -------------------------------- orders --------------------------------- */

export async function createPendingOrder(input: {
  workspaceId: string;
  pageId: string | null;
  productId: string | null;
  amountCents: number;
  currency: string;
  stripeSessionId: string;
}): Promise<string> {
  const id = uid();
  await db.insert(orders).values({
    id,
    workspace_id: input.workspaceId,
    page_id: input.pageId,
    product_id: input.productId,
    stripe_session_id: input.stripeSessionId,
    status: "pending",
    amount_cents: input.amountCents,
    currency: input.currency,
    created_at: new Date(),
  });
  return id;
}

/** Called by the Stripe webhook on checkout.session.completed. */
export async function markOrderPaidBySession(
  stripeSessionId: string,
  customerEmail?: string | null,
): Promise<void> {
  // tenant-scope-exempt: Stripe webhook has no workspace context; the session id
  // is a unique, Stripe-issued token identifying exactly one order.
  await db
    .update(orders)
    .set({ status: "paid", customer_email: customerEmail ?? null })
    .where(eq(orders.stripe_session_id, stripeSessionId));
}

export async function listOrders(workspaceId: string): Promise<Order[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.workspace_id, workspaceId))
    .orderBy(desc(orders.created_at));
  return rows.map(toOrder);
}
