import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "ATLAS Organizer",
  description: "Reference Next.js operator app",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          margin: 0,
          padding: 0,
          color: "#111",
          background: "#fafafa",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.5rem",
            padding: "1rem 1.5rem",
            borderBottom: "1px solid #e5e5e5",
            background: "#fff",
          }}
        >
          <strong style={{ fontSize: "1.05rem" }}>ATLAS Organizer</strong>
          <nav style={{ display: "flex", gap: "1rem", fontSize: "0.95rem" }}>
            <Link href="/" style={{ color: "#0a4cff", textDecoration: "none" }}>
              Events
            </Link>
            <a
              href="/api/.well-known/atlas.json"
              style={{ color: "#0a4cff", textDecoration: "none" }}
            >
              Manifest
            </a>
          </nav>
        </header>
        <main style={{ padding: "1.5rem", maxWidth: "960px", margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
