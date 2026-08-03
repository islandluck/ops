"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
// These two actions are generic (workspace-scoped, not page-specific): they
// store bytes in our media bucket and return a public URL. Reused anywhere we
// need an "upload or pick a stock photo" slot.
import { attachStockToPageAction, searchStockAction, uploadPageImageAction } from "@/app/actions";
import type { StockImage } from "@/lib/ai/stock";

/** Reusable image slot: upload a file or pick a Pexels stock photo; yields a URL. */
export function ImageSlot({
  value,
  onChange,
  label,
  variant = "wide",
}: {
  value?: string;
  onChange: (url: string | null) => void;
  label: string;
  variant?: "logo" | "wide";
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "stock">("upload");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockImage[]>([]);
  const [searching, setSearching] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [attaching, setAttaching] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadPageImageAction(fd);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.ok && res.url) {
      onChange(res.url);
      setOpen(false);
    } else {
      setErr(res.error ?? "Upload failed.");
    }
  }

  async function runSearch() {
    if (!q.trim()) return;
    setSearching(true);
    setErr("");
    const res = await searchStockAction(q.trim());
    setSearching(false);
    setConfigured(res.configured);
    setResults(res.images);
  }

  async function pickStock(img: StockImage) {
    setAttaching(img.url);
    setErr("");
    const res = await attachStockToPageAction(img.url);
    setAttaching(null);
    if (res.ok && res.url) {
      onChange(res.url);
      setOpen(false);
    } else {
      setErr(res.error ?? "Couldn't add that image.");
    }
  }

  return (
    <div className="space-y-2">
      {value && (
        <div className="group relative overflow-hidden rounded-lg border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className={cn(
              "w-full",
              variant === "logo" ? "mx-auto h-14 w-auto object-contain p-2" : "aspect-[16/9] object-cover",
            )}
          />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-900/0 opacity-0 transition group-hover:bg-slate-900/40 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="rounded-md bg-white/95 px-2.5 py-1 text-[12px] font-medium text-slate-900 shadow-sm hover:bg-white"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-md bg-white/95 px-2.5 py-1 text-[12px] font-medium text-red-600 shadow-sm hover:bg-white"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {!value && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-[12.5px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          <ImagePlus className="h-4 w-4" />
          Add {label}
        </button>
      )}

      {open && (
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Segmented
              options={[
                { value: "upload", label: "Upload" },
                { value: "stock", label: "Stock" },
              ]}
              value={tab}
              onChange={(v) => setTab(v as "upload" | "stock")}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label="Close image picker"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {tab === "upload" ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-6 text-[12.5px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy ? "Uploading…" : "Choose an image (max 10 MB)"}
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runSearch();
                    }
                  }}
                  placeholder="Search stock photos…"
                  className="h-8"
                />
                <Button size="sm" variant="outline" onClick={runSearch} disabled={searching || !q.trim()}>
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              {!configured && (
                <p className="text-[11.5px] text-amber-600">
                  Stock search needs a Pexels API key (PEXELS_API_KEY). Upload works either way.
                </p>
              )}
              {results.length > 0 && (
                <div className="grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto">
                  {results.map((img) => (
                    <button
                      key={img.url}
                      type="button"
                      onClick={() => pickStock(img)}
                      disabled={attaching !== null}
                      title={img.attribution}
                      className="relative aspect-[4/3] overflow-hidden rounded-md border border-border transition hover:ring-2 hover:ring-primary"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.thumb} alt={img.alt} className="h-full w-full object-cover" />
                      {attaching === img.url && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50">
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {err && <p className="mt-1.5 text-[11.5px] text-destructive">{err}</p>}
        </div>
      )}
    </div>
  );
}
