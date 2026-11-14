import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { InstallHint } from "@/components/InstallHint";
import { BottomNav } from "@/components/BottomNav";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { AuthGate } from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "Geo PYQ — UGC NET & SET Geography",
  description:
    "Previous year questions and timed mock tests for UGC NET Paper I, Geography Paper II, and State SET Geography.",
  appleWebApp: {
    capable: true,
    title: "Geo PYQ",
    statusBarStyle: "default",
  },
  other: {
    // Next only emits the modern `mobile-web-app-capable`; older iOS versions
    // still need the apple-prefixed tag to launch in standalone mode.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#15616d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <ConfirmProvider>
            <AuthGate>{children}</AuthGate>
            <BottomNav />
            <InstallHint />
          </ConfirmProvider>
        </AuthProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
