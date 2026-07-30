import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { PageContent, PageType } from "@/lib/types";

/**
 * Landing/product/blog page generator — writes on-brand, conversion-focused page
 * content (a page with a buy button) grounded in the business brief. Server-only;
 * gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

export interface PageBrief {
  company_name: string;
  business_description: string;
  core_offer: string;
  ideal_customer_profile: string;
  voice_rules: string[];
  restricted_phrases: string[];
}

export interface GeneratedPage {
  title: string;
  content: PageContent;
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function generatePageContent(input: {
  brief: PageBrief;
  offer: string;
  pageType: PageType;
  productName?: string;
  priceLabel?: string;
}): Promise<GeneratedPage> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI page generation is not configured (ANTHROPIC_API_KEY missing).");

  const { brief, offer, pageType, productName, priceLabel } = input;
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const kind =
    pageType === "product"
      ? "product page that sells a specific offer"
      : pageType === "blog"
        ? "blog article that ranks in search and routes readers toward the offer"
        : "landing page that converts visitors into buyers";

  const system = [
    `You are a senior conversion copywriter for ${brief.company_name || "the business"}.`,
    `${brief.business_description} ${brief.core_offer}`.trim(),
    brief.ideal_customer_profile ? `Ideal customer: ${brief.ideal_customer_profile}` : "",
    brief.voice_rules.length ? `Brand voice: ${brief.voice_rules.join("; ")}` : "",
    brief.restricted_phrases.length ? `Never use: ${brief.restricted_phrases.join(", ")}` : "",
    "",
    `Write a high-converting ${kind}.`,
    productName ? `It sells: ${productName}${priceLabel ? ` (${priceLabel})` : ""}.` : "",
    "Be specific and benefit-led — speak to the customer's real problem, then the transformation. No fluff, no clichés, no placeholders like [X].",
    "Structure: a strong headline, a one-sentence subheadline, 3–5 sections (e.g. the problem, the solution, how it works, why it's different, what you get), 3 concise features, a punchy CTA button label, and a short reassuring footer note.",
    "",
    "Respond with ONLY this JSON (no markdown, no code fences, no commentary):",
    '{"title": string (<=70 chars), "headline": string, "subheadline": string, "cta_label": string (<=24 chars), "sections": [{"heading": string, "body": string}], "features": [{"title": string, "body": string}], "footer_note": string}',
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system,
    messages: [{ role: "user", content: `The offer / focus of this page: ${offer}\n\nWrite it now.` }],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(stripFences(text)) as Record<string, unknown>;
  } catch {
    throw new Error("The page generator returned unreadable content. Please try again.");
  }

  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .slice(0, 6)
        .map((s) => {
          const sr = (s ?? {}) as Record<string, unknown>;
          return { heading: str(sr.heading, 140), body: str(sr.body, 1400) };
        })
        .filter((s) => s.heading || s.body)
    : [];
  const features = Array.isArray(raw.features)
    ? raw.features
        .slice(0, 6)
        .map((f) => {
          const fr = (f ?? {}) as Record<string, unknown>;
          return { title: str(fr.title, 90), body: str(fr.body, 320) };
        })
        .filter((f) => f.title)
    : [];

  const content: PageContent = {
    headline: str(raw.headline, 220) || offer.slice(0, 220),
    subheadline: str(raw.subheadline, 320),
    cta_label: str(raw.cta_label, 24) || "Get started",
    sections,
    features: features.length ? features : undefined,
    footer_note: raw.footer_note ? str(raw.footer_note, 320) : undefined,
  };

  return { title: str(raw.title, 80) || offer.slice(0, 80) || "Untitled page", content };
}
