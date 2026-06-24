import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { Toaster } from "@/components/toaster";

export const metadata: Metadata = {
  title: "Operator — the Approval Center",
  description:
    "Run the repetitive parts of your business from one place. Agents prepare work across growth, admin, content, and research. You review what matters and approve execution in one click.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          {children}
          <Toaster />
        </StoreProvider>
      </body>
    </html>
  );
}
