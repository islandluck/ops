"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  Palette,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ImageSlot } from "@/components/media/image-slot";
import { PageView } from "@/components/pages/page-view";
import { cn } from "@/lib/cn";
import {
  getPageAction,
  getProductsAction,
  publishPageAction,
  unpublishPageAction,
  updatePageAction,
} from "@/app/actions";
import type { Page, PageContent, Product } from "@/lib/types";

/** Preset accent swatches — a considered spread, not a rainbow. */
const ACCENTS = [
  "#0f172a",
  "#2a44c0",
  "#0e8a5f",
  "#0891b2",
  "#7c3aed",
  "#db2777",
  "#c2410c",
  "#b91c1c",
];

function price(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export default function PageEditor() {
  const params = useParams();
  const id = String((params as { id?: string })?.id ?? "");

  const [page, setPage] = useState<Page | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<PageContent | null>(null);
  const [productId, setProductId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyPublish, setBusyPublish] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, prods] = await Promise.all([getPageAction(id), getProductsAction()]);
      if (!alive) return;
      if (p) {
        setPage(p);
        setTitle(p.title);
        setContent(p.content);
        setProductId(p.product_id ?? "");
      }
      setProducts(prods);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  function patch(partial: Partial<PageContent>) {
    setContent((c) => (c ? { ...c, ...partial } : c));
    setDirty(true);
    setSavedOnce(false);
    setError("");
  }
  function editTitle(v: string) {
    setTitle(v);
    setDirty(true);
    setSavedOnce(false);
  }
  function editProduct(v: string) {
    setProductId(v);
    setDirty(true);
    setSavedOnce(false);
  }

  const sections = content?.sections ?? [];
  function setSection(i: number, p: Partial<PageContent["sections"][number]>) {
    patch({ sections: sections.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  }
  function addSection() {
    patch({ sections: [...sections, { heading: "New section", body: "" }] });
  }
  function removeSection(i: number) {
    patch({ sections: sections.filter((_, j) => j !== i) });
  }
  function moveSection(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const arr = sections.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    patch({ sections: arr });
  }

  const features = content?.features ?? [];
  function setFeature(i: number, p: Partial<{ title: string; body: string }>) {
    patch({ features: features.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  }
  function addFeature() {
    patch({ features: [...features, { title: "New feature", body: "" }] });
  }
  function removeFeature(i: number) {
    patch({ features: features.filter((_, j) => j !== i) });
  }

  async function save() {
    if (!content) return;
    setSaving(true);
    setError("");
    const res = await updatePageAction(id, { title, content, product_id: productId || null });
    setSaving(false);
    if (res.ok) {
      setDirty(false);
      setSavedOnce(true);
      setPage((p) => (p ? { ...p, title, content, product_id: productId || null } : p));
    } else {
      setError(res.error ?? "Couldn't save your changes.");
    }
  }

  async function togglePublish() {
    if (!page) return;
    setBusyPublish(true);
    if (dirty) await save();
    const res =
      page.status === "published"
        ? await unpublishPageAction(id)
        : await publishPageAction(id);
    setBusyPublish(false);
    if (res.ok) {
      setPage((p) =>
        p ? { ...p, status: p.status === "published" ? "draft" : "published" } : p,
      );
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!page || !content) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="text-base font-semibold">We couldn&apos;t find that page</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          It may have been deleted, or the link is out of date.
        </p>
        <Link href="/pages" className="inline-flex">
          <Button size="sm" variant="outline">
            <ArrowLeft className="h-4 w-4" />
            Back to Pages
          </Button>
        </Link>
      </div>
    );
  }

  const product = products.find((p) => p.id === productId) ?? null;
  const priceLabel = product ? price(product.price_cents, product.currency) : null;
  const statusLabel = saving
    ? "Saving…"
    : dirty
      ? "Unsaved changes"
      : savedOnce
        ? "All changes saved"
        : page.status === "published"
          ? "Published"
          : "Draft";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card px-3 py-2.5 sm:px-4">
        <Link href="/pages" className="inline-flex">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Pages</span>
          </Button>
        </Link>
        <div className="mx-1 h-5 w-px bg-border" />
        <input
          value={title}
          onChange={(e) => editTitle(e.target.value)}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[15px] font-semibold outline-none focus:bg-accent/50 placeholder:font-normal placeholder:text-muted-foreground"
          placeholder="Untitled page"
        />
        <span
          className={cn(
            "hidden text-[11.5px] md:inline",
            dirty ? "text-amber-600" : "text-muted-foreground",
          )}
        >
          {statusLabel}
        </span>
        {page.status === "published" && (
          <a href={`/p/${page.slug}`} target="_blank" rel="noreferrer" className="inline-flex">
            <Button variant="ghost" size="sm">
              <Eye className="h-4 w-4" />
              <span className="hidden lg:inline">View</span>
            </Button>
          </a>
        )}
        <Button variant="outline" size="sm" onClick={togglePublish} disabled={busyPublish}>
          {busyPublish && <Loader2 className="h-4 w-4 animate-spin" />}
          {page.status === "published" ? "Unpublish" : "Publish"}
        </Button>
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save
        </Button>
      </div>

      {/* Two-pane: inspector + live preview */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* Inspector */}
        <div className="shrink-0 space-y-7 border-b border-border bg-card px-4 py-5 lg:w-[400px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
              {error}
            </p>
          )}

          <Group title="Brand">
            <Field label="Logo">
              <ImageSlot
                label="logo"
                variant="logo"
                value={content.logo_url}
                onChange={(url) => patch({ logo_url: url ?? undefined })}
              />
            </Field>
            <Field label="Accent color">
              <div className="flex flex-wrap items-center gap-1.5">
                {ACCENTS.map((hex) => {
                  const active = (content.accent ?? "#0f172a").toLowerCase() === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => patch({ accent: hex })}
                      aria-label={hex}
                      className={cn(
                        "h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-card transition",
                        active ? "ring-foreground" : "ring-transparent hover:ring-border",
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  );
                })}
                <label
                  className="relative ml-0.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground"
                  title="Custom color"
                >
                  <input
                    type="color"
                    value={content.accent ?? "#0f172a"}
                    onChange={(e) => patch({ accent: e.target.value })}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  <Palette className="h-3.5 w-3.5" />
                </label>
              </div>
            </Field>
          </Group>

          <Group title="Hero">
            <Field label="Headline">
              <Input
                value={content.headline}
                onChange={(e) => patch({ headline: e.target.value })}
                placeholder="Your headline"
              />
            </Field>
            <Field label="Subheadline">
              <Textarea
                value={content.subheadline}
                onChange={(e) => patch({ subheadline: e.target.value })}
                className="min-h-[70px]"
                placeholder="A sentence that sells the promise."
              />
            </Field>
            <Field label="Button label">
              <Input
                value={content.cta_label}
                onChange={(e) => patch({ cta_label: e.target.value })}
                placeholder="Get started"
              />
            </Field>
            <Field label="Hero image">
              <ImageSlot
                label="hero image"
                value={content.hero_image_url}
                onChange={(url) => patch({ hero_image_url: url ?? undefined })}
              />
            </Field>
          </Group>

          <Group title="Buy button">
            <Field label="Product">
              <Select value={productId} onChange={(e) => editProduct(e.target.value)}>
                <option value="">No product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {price(p.price_cents, p.currency)}
                  </option>
                ))}
              </Select>
              {!productId && (
                <p className="mt-1 text-[11.5px] text-amber-600">
                  The buy button stays inactive until a product is attached.
                </p>
              )}
            </Field>
          </Group>

          <Group
            title="Features"
            action={
              <AddButton onClick={addFeature} disabled={features.length >= 6}>
                Add
              </AddButton>
            }
          >
            {features.length === 0 ? (
              <Empty>No feature cards. Add up to six to highlight what buyers get.</Empty>
            ) : (
              <div className="space-y-2.5">
                {features.map((f, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Feature {i + 1}
                      </span>
                      <IconBtn label="Remove feature" danger onClick={() => removeFeature(i)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    </div>
                    <Input
                      value={f.title}
                      onChange={(e) => setFeature(i, { title: e.target.value })}
                      placeholder="Feature title"
                    />
                    <Textarea
                      value={f.body}
                      onChange={(e) => setFeature(i, { body: e.target.value })}
                      className="min-h-[54px]"
                      placeholder="One line about this feature."
                    />
                  </div>
                ))}
              </div>
            )}
          </Group>

          <Group
            title="Sections"
            action={
              <AddButton onClick={addSection} disabled={sections.length >= 12}>
                Add
              </AddButton>
            }
          >
            {sections.length === 0 ? (
              <Empty>No sections yet. Add one to tell more of the story.</Empty>
            ) : (
              <div className="space-y-3">
                {sections.map((s, i) => (
                  <div key={i} className="space-y-2.5 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Section {i + 1}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <IconBtn label="Move up" disabled={i === 0} onClick={() => moveSection(i, -1)}>
                          <ChevronUp className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn
                          label="Move down"
                          disabled={i === sections.length - 1}
                          onClick={() => moveSection(i, 1)}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </IconBtn>
                        <IconBtn label="Remove section" danger onClick={() => removeSection(i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconBtn>
                      </div>
                    </div>
                    <Input
                      value={s.heading}
                      onChange={(e) => setSection(i, { heading: e.target.value })}
                      placeholder="Section heading"
                    />
                    <Textarea
                      value={s.body}
                      onChange={(e) => setSection(i, { body: e.target.value })}
                      className="min-h-[80px]"
                      placeholder="Section text…"
                    />
                    <ImageSlot
                      label="section image"
                      value={s.image_url}
                      onChange={(url) => setSection(i, { image_url: url ?? undefined })}
                    />
                  </div>
                ))}
              </div>
            )}
          </Group>

          <Group title="Footer">
            <Field label="Footer note">
              <Input
                value={content.footer_note ?? ""}
                onChange={(e) => patch({ footer_note: e.target.value || undefined })}
                placeholder="e.g. 30-day money-back guarantee."
              />
            </Field>
          </Group>
        </div>

        {/* Live preview */}
        <div className="min-w-0 flex-1 bg-muted/20 p-4 sm:p-6 lg:overflow-y-auto">
          <div className="mx-auto max-w-[880px]">
            <div className="mb-3 flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                /p/{page.slug}
              </span>
              <span>Live preview</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
              <PageView
                content={content}
                product={product}
                priceLabel={priceLabel}
                interactive={false}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- helpers -------------------------------- */

function Group({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
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

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground transition hover:bg-accent disabled:pointer-events-none disabled:opacity-30",
        danger && "hover:text-red-600",
      )}
    >
      {children}
    </button>
  );
}

function AddButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-primary transition hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
    >
      <Plus className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
      {children}
    </p>
  );
}
