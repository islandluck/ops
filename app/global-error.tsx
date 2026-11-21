"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for an error thrown by the ROOT layout itself (which app/error.tsx
 * lives inside and cannot catch). It must render its own <html>/<body>, and is kept
 * dependency-free + inline-styled so it still renders if the app's CSS or providers are
 * exactly what failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fafafa",
          color: "#0a0a0a",
        }}
      >
        <div style={{ maxWidth: "24rem", textAlign: "center", padding: "0 1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.5rem" }}>Something went wrong</h2>
          <p style={{ fontSize: "0.875rem", color: "#525252", margin: "0 0 1.25rem", lineHeight: 1.5 }}>
            The app hit an unexpected error. Please reload the page — if it keeps happening, try again shortly.
          </p>
          <button
            onClick={() => reset()}
            style={{
              appearance: "none",
              border: "none",
              borderRadius: "0.5rem",
              background: "#4f46e5",
              color: "#fff",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
