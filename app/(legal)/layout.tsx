import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand";

/**
 * Public legal pages (Terms / Privacy / Refunds) — outside the (product) auth
 * group and NOT in the middleware's protected prefixes, so anyone (and Google's
 * OAuth review) can read them without signing in.
 */
export const metadata = {
  title: "Legal — Operator",
};

const DOCS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refunds", label: "Refund Policy" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo className="h-6 w-auto" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-8 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {2026} Andros Innovations. All rights reserved.</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-1">
            {DOCS.map((d) => (
              <Link key={d.href} href={d.href} className="transition hover:text-foreground">
                {d.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
