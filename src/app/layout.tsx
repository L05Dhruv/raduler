import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { TimeZoneProvider } from "@/contexts/TimeZoneContext";
import { ToastProvider } from "@/components/ui/Toast";
import { CSP_CONTENT, CSP_ENABLED } from "@/lib/security/csp";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Raduler — Radiology Shift Scheduling",
  description:
    "Shift calendar, time-off requests, hours reporting and invoicing for a radiology group.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Matches the dark theme's page surface so mobile browser chrome doesn't sit
  // as a bright band above a dark UI.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#14161b" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          A meta CSP is weaker than a real response header — it cannot express
          frame-ancestors, and a static host gives us nowhere to set headers. It still
          blocks the common injection paths, so it earns its place. See SECURITY.md.
        */}
        {CSP_ENABLED && (
          <meta httpEquiv="Content-Security-Policy" content={CSP_CONTENT} />
        )}
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        {/* Applies the stored theme before first paint; without it a light-mode
            user watches the dark default flash first. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        {/* TimeZoneProvider sits inside AuthProvider: the home zone comes off the
            profile, and the practice zone from an RPC only signed-in users may call. */}
        <AuthProvider>
          <TimeZoneProvider>
            <ToastProvider>{children}</ToastProvider>
          </TimeZoneProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
