import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { formatPrice, getProduct, getPublishedPageBySlug } from "@/lib/pages";
import { PageView } from "@/components/pages/page-view";

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
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <main className="min-h-screen bg-white">
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
      <PageView content={page.content} product={product} priceLabel={priceLabel} slug={page.slug} interactive />
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
