import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { CSP_CONTENT } from "@/lib/security/csp";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Raduler — Radiology Shift Scheduling",
  description:
    "Shift calendar, time-off requests, hours reporting and invoicing for a radiology group.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/*
          A meta CSP is weaker than a real response header — it cannot express
          frame-ancestors, and a static host gives us nowhere to set headers. It still
          blocks the common injection paths, so it earns its place. See SECURITY.md.
        */}
        <meta httpEquiv="Content-Security-Policy" content={CSP_CONTENT} />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
