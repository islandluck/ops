import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { formatPrice, getProduct, getPublishedPageBySlug } from "@/lib/pages";
import type { Page, Product } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = await getPublishedPageBySlug(slug);
  if (!page) notFound();

  const product = page.product_id ? await getProduct(page.workspace_id, page.product_id) : null;
  const priceLabel = product ? formatPrice(product.price_cents, product.currency) : null;
  const c = page.content;
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      {sp.paid === "1" && (
        <Banner tone="ok">🎉 Payment successful — thank you! A confirmation is on its way by email.</Banner>
      )}
      {sp.canceled === "1" && <Banner tone="warn">Checkout canceled — no charge was made.</Banner>}
      {error === "payments-not-configured" && (
        <Banner tone="warn">Payments aren&apos;t switched on for this page yet.</Banner>
      )}
      {error === "no-product" && <Banner tone="warn">This page doesn&apos;t have a product attached yet.</Banner>}
      {error === "checkout-failed" && (
        <Banner tone="warn">Something went wrong starting checkout — please try again.</Banner>
      )}

      <section className="mx-auto max-w-3xl px-6 pb-14 pt-24 text-center">
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">{c.headline}</h1>
        {c.subheadline && (
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg leading-relaxed text-slate-600">
            {c.subheadline}
          </p>
        )}
        <div className="mt-9">
          <BuyButton page={page} product={product} priceLabel={priceLabel} cta={c.cta_label} />
        </div>
      </section>

      {c.features && c.features.length > 0 && (
        <section className="mx-auto max-w-4xl px-6 pb-16">
          <div className="grid gap-5 sm:grid-cols-3">
            {c.features.map((f, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {c.sections && c.sections.length > 0 && (
        <section className="mx-auto max-w-2xl space-y-12 px-6 pb-20">
          {c.sections.map((s, i) => (
            <div key={i}>
              <h2 className="text-2xl font-semibold tracking-tight">{s.heading}</h2>
              <p className="mt-3 whitespace-pre-line leading-relaxed text-slate-700">{s.body}</p>
            </div>
          ))}
        </section>
      )}

      <section className="border-t border-slate-100 px-6 py-16 text-center">
        <BuyButton page={page} product={product} priceLabel={priceLabel} cta={c.cta_label} />
        {c.footer_note && <p className="mx-auto mt-4 max-w-md text-sm text-slate-500">{c.footer_note}</p>}
      </section>
    </main>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn"; children: ReactNode }) {
  return (
    <div
      className={`px-6 py-3 text-center text-sm font-medium ${
        tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
      }`}
    >
      {children}
    </div>
  );
}

function BuyButton({
  page,
  product,
  priceLabel,
  cta,
}: {
  page: Page;
  product: Product | null;
  priceLabel: string | null;
  cta: string;
}) {
  if (!product) {
    return (
      <span className="inline-flex cursor-not-allowed rounded-xl bg-slate-900 px-7 py-3.5 text-[15px] font-semibold text-white opacity-50">
        {cta}
      </span>
    );
  }
  return (
    <form action="/api/checkout" method="POST" className="inline-flex flex-col items-center gap-2">
      <input type="hidden" name="page" value={page.slug} />
      <button
        type="submit"
        className="rounded-xl bg-slate-900 px-7 py-3.5 text-[15px] font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        {cta}
        {priceLabel ? ` — ${priceLabel}` : ""}
      </button>
      <span className="text-xs text-slate-400">Secure checkout via Stripe</span>
    </form>
  );
}
