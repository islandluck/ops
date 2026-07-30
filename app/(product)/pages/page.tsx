"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Eye,
  Loader2,
  Package,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import {
  attachProductToPageAction,
  createProductAction,
  deletePageAction,
  generatePageAction,
  getPagesAction,
  getProductsAction,
  publishPageAction,
  unpublishPageAction,
} from "@/app/actions";
import type { Page, PageType, Product } from "@/lib/types";

function price(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

const TYPE_LABEL: Record<PageType, string> = { landing: "Landing", product: "Product", blog: "Blog" };

export default function PagesPage() {
  const [pages, setPages] = useState<Page[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPage, setNewPage] = useState(false);
  const [newProduct, setNewProduct] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function reload() {
    try {
      const [p, pr] = await Promise.all([getPagesAction(), getProductsAction()]);
      setPages(p);
      setProducts(pr);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  const selected = pages.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Pages"
        description="Generate on-brand landing, product, and blog pages — each a page with a buy button. Publish and it goes live in-app at /p/…, ready to take a (test) sale."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setNewProduct(true)}>
              <Package className="h-4 w-4" />
              New product
            </Button>
            <Button size="sm" onClick={() => setNewPage(true)}>
              <Plus className="h-4 w-4" />
              New page
            </Button>
          </div>
        }
      />
      <PageBody>
        {loading ? (
          <div className="flex justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : pages.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold">No pages yet</h3>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
                Describe an offer and Operator writes a full landing page — headline, sections, and a buy button —
                grounded in your brief. Attach a product, publish, and it&apos;s live.
              </p>
            </div>
            <Button size="sm" onClick={() => setNewPage(true)}>
              <Plus className="h-4 w-4" />
              Generate a page
            </Button>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pages.map((p) => {
              const product = products.find((pr) => pr.id === p.product_id) ?? null;
              return (
                <Card key={p.id} className="card-interactive flex cursor-pointer flex-col p-4" onClick={() => setSelectedId(p.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        p.status === "published"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-500",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", p.status === "published" ? "bg-emerald-500" : "bg-slate-400")} />
                      {p.status === "published" ? "Live" : "Draft"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{TYPE_LABEL[p.page_type]}</span>
                  </div>
                  <h3 className="mt-2.5 line-clamp-2 text-[14px] font-semibold leading-snug">{p.title}</h3>
                  <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{p.content.headline}</p>
                  <div className="mt-3 flex-1" />
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[11px]">
                    <span className="truncate text-muted-foreground">/p/{p.slug}</span>
                    {product ? (
                      <span className="font-medium text-foreground">{price(product.price_cents, product.currency)}</span>
                    ) : (
                      <span className="text-amber-600">No product</span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>

      {newProduct && (
        <NewProductDrawer
          onClose={() => setNewProduct(false)}
          onCreated={async () => {
            setNewProduct(false);
            await reload();
          }}
        />
      )}
      {newPage && (
        <NewPageDrawer
          products={products}
          onOpenProduct={() => {
            setNewPage(false);
            setNewProduct(true);
          }}
          onClose={() => setNewPage(false)}
          onCreated={async (id) => {
            setNewPage(false);
            await reload();
            setSelectedId(id);
          }}
        />
      )}
      {selected && (
        <PageDetailDrawer
          page={selected}
          products={products}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}

function NewProductDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const dollars = parseFloat(priceStr);
    if (!name.trim() || Number.isNaN(dollars)) {
      setError("Give the product a name and a price.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await createProductAction({ name: name.trim(), price_cents: Math.round(dollars * 100), description });
    setBusy(false);
    if (res.ok) onCreated();
    else setError(res.error ?? "Couldn't create the product.");
  }

  return (
    <Drawer open onClose={onClose}>
      <DrawerHeader label="New product" title="What are you selling?" onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FocusFlow Pro — annual" autoFocus />
        </Field>
        <Field label="Price (USD)">
          <Input value={priceStr} onChange={(e) => setPriceStr(e.target.value)} inputMode="decimal" placeholder="49.00" />
        </Field>
        <Field label="Description (optional)">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[70px]" placeholder="One line about what the buyer gets." />
        </Field>
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </div>
      <div className="shrink-0 border-t border-border px-5 py-3.5">
        <Button variant="success" className="w-full" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Create product
        </Button>
      </div>
    </Drawer>
  );
}

function NewPageDrawer({
  products,
  onClose,
  onCreated,
  onOpenProduct,
}: {
  products: Product[];
  onClose: () => void;
  onCreated: (pageId: string) => void;
  onOpenProduct: () => void;
}) {
  const [offer, setOffer] = useState("");
  const [pageType, setPageType] = useState<PageType>("landing");
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!offer.trim()) return;
    setBusy(true);
    setError("");
    const res = await generatePageAction({ offer: offer.trim(), pageType, productId: productId || null });
    setBusy(false);
    if (res.ok && res.page) onCreated(res.page.id);
    else setError(res.error ?? "Couldn't generate the page.");
  }

  return (
    <Drawer open onClose={onClose}>
      <DrawerHeader label="New page" title="Describe the page" onClose={onClose} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <Field label="What's this page for?">
          <Textarea
            autoFocus
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            className="min-h-[100px]"
            placeholder="e.g. A landing page for FocusFlow — an app that blocks distractions and plans your day. Aimed at busy founders."
          />
        </Field>
        <Field label="Type">
          <Segmented
            options={[
              { value: "landing", label: "Landing" },
              { value: "product", label: "Product" },
              { value: "blog", label: "Blog" },
            ]}
            value={pageType}
            onChange={(v) => setPageType(v as PageType)}
          />
        </Field>
        <Field label="Product (the buy button)">
          {products.length ? (
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">No product yet</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {price(p.price_cents, p.currency)}
                </option>
              ))}
            </Select>
          ) : (
            <button type="button" onClick={onOpenProduct} className="text-[13px] text-primary hover:underline">
              + Create a product first
            </button>
          )}
        </Field>
        {error && <p className="text-[12.5px] text-destructive">{error}</p>}
      </div>
      <div className="shrink-0 border-t border-border px-5 py-3.5">
        <Button variant="success" className="w-full" onClick={submit} disabled={busy || !offer.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Writing the page…" : "Generate page"}
        </Button>
      </div>
    </Drawer>
  );
}

function PageDetailDrawer({
  page,
  products,
  onClose,
  onChanged,
}: {
  page: Page;
  products: Product[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const c = page.content;
  const publicUrl = `/p/${page.slug}`;

  async function act(fn: () => Promise<{ ok: boolean }>) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose}>
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              page.status === "published"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-100 text-slate-500",
            )}
          >
            {page.status === "published" ? "Live" : "Draft"}
          </span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
            ✕
          </button>
        </div>
        <h2 className="mt-2 text-[17px] font-semibold leading-snug">{page.title}</h2>
        {page.status === "published" && (
          <a href={publicUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
            <ExternalLink className="h-3 w-3" /> {publicUrl}
          </a>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <h3 className="text-[16px] font-bold leading-snug">{c.headline}</h3>
          {c.subheadline && <p className="mt-1.5 text-[13px] text-muted-foreground">{c.subheadline}</p>}
          <span className="mt-3 inline-flex rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white">
            {c.cta_label}
          </span>
        </div>

        <div className="space-y-1.5">
          <Label>Product (the buy button)</Label>
          <Select
            value={page.product_id ?? ""}
            onChange={(e) => act(() => attachProductToPageAction(page.id, e.target.value || null))}
          >
            <option value="">No product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {price(p.price_cents, p.currency)}
              </option>
            ))}
          </Select>
          {!page.product_id && (
            <p className="text-[11.5px] text-amber-600">The buy button is inactive until a product is attached.</p>
          )}
        </div>

        {c.features && c.features.length > 0 && (
          <div className="space-y-2">
            <Label>Features</Label>
            {c.features.map((f, i) => (
              <div key={i} className="rounded-lg border border-border p-2.5">
                <p className="text-[13px] font-medium">{f.title}</p>
                <p className="text-[12px] text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        )}

        {c.sections && c.sections.length > 0 && (
          <div className="space-y-3">
            <Label>Sections</Label>
            {c.sections.map((s, i) => (
              <div key={i}>
                <p className="text-[13px] font-semibold">{s.heading}</p>
                <p className="mt-0.5 line-clamp-3 text-[12px] text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3.5">
        {page.status === "published" ? (
          <>
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => act(() => unpublishPageAction(page.id))}>
              Unpublish
            </Button>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex">
              <Button variant="primary">
                <Eye className="h-4 w-4" />
                View
              </Button>
            </a>
          </>
        ) : (
          <Button variant="success" className="flex-1" disabled={busy} onClick={() => act(() => publishPageAction(page.id))}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Publish page
          </Button>
        )}
        <Button variant="destructive" disabled={busy} onClick={() => act(() => deletePageAction(page.id))} title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Drawer>
  );
}

function DrawerHeader({ label, title, onClose }: { label: string; title: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
      <div>
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        <h2 className="text-[17px] font-semibold">{title}</h2>
      </div>
      <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Close">
        ✕
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
