import type { PageContent, Product } from "@/lib/types";

/**
 * Presentational renderer for a page's content. Deliberately has no "use client"
 * and no hooks so it renders identically in the public server route (/p/[slug])
 * and in the editor's live preview — one source of truth for how a page looks.
 * `interactive` makes the buy button a real Checkout form; otherwise it's display-only.
 */
export function PageView({
  content,
  product,
  priceLabel,
  slug,
  interactive = false,
}: {
  content: PageContent;
  product: Product | null;
  priceLabel: string | null;
  slug?: string;
  interactive?: boolean;
}) {
  const accent = content.accent?.trim() || "#0f172a";
  const cta = content.cta_label || "Get started";
  const ctaProps = { accent, label: cta, priceLabel, interactive, hasProduct: !!product, slug };

  return (
    <div className="bg-white text-slate-900">
      {content.logo_url && (
        <header className="flex justify-center px-6 pt-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={content.logo_url} alt="Logo" className="h-9 w-auto object-contain" />
        </header>
      )}

      <section className="mx-auto max-w-3xl px-6 pb-10 pt-16 text-center">
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          {content.headline || "Your headline"}
        </h1>
        {content.subheadline && (
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg leading-relaxed text-slate-600">
            {content.subheadline}
          </p>
        )}
        <div className="mt-8">
          <Cta {...ctaProps} />
        </div>
        {content.hero_image_url && (
          <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={content.hero_image_url} alt="" className="w-full object-cover" />
          </div>
        )}
      </section>

      {content.features && content.features.length > 0 && (
        <section className="mx-auto max-w-4xl px-6 pb-14">
          <div className="grid gap-5 sm:grid-cols-3">
            {content.features.map((f, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-6">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {content.sections && content.sections.length > 0 && (
        <section className="mx-auto max-w-2xl space-y-12 px-6 pb-16">
          {content.sections.map((s, i) => (
            <div key={i}>
              <h2 className="text-2xl font-semibold tracking-tight">{s.heading}</h2>
              {s.body && <p className="mt-3 whitespace-pre-line leading-relaxed text-slate-700">{s.body}</p>}
              {s.image_url && (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.image_url} alt="" className="w-full object-cover" />
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="border-t border-slate-100 px-6 py-14 text-center">
        <Cta {...ctaProps} />
        {content.footer_note && <p className="mx-auto mt-4 max-w-md text-sm text-slate-500">{content.footer_note}</p>}
      </section>
    </div>
  );
}

function Cta({
  accent,
  label,
  priceLabel,
  interactive,
  hasProduct,
  slug,
}: {
  accent: string;
  label: string;
  priceLabel: string | null;
  interactive: boolean;
  hasProduct: boolean;
  slug?: string;
}) {
  const text = `${label}${priceLabel ? ` — ${priceLabel}` : ""}`;
  const cls = "inline-flex items-center rounded-xl px-7 py-3.5 text-[15px] font-semibold text-white shadow-sm transition hover:opacity-90";

  if (interactive && hasProduct && slug) {
    return (
      <form action="/api/checkout" method="POST" className="inline-flex flex-col items-center gap-2">
        <input type="hidden" name="page" value={slug} />
        <button type="submit" className={cls} style={{ backgroundColor: accent }}>
          {text}
        </button>
        <span className="text-xs text-slate-400">Secure checkout via Stripe</span>
      </form>
    );
  }
  return (
    <span
      className={cls}
      style={{ backgroundColor: accent, opacity: interactive && !hasProduct ? 0.5 : 1 }}
    >
      {text}
    </span>
  );
}
