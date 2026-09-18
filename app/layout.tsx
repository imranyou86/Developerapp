import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { BackgroundTasksProvider } from "@/components/BackgroundTasks";

export const metadata: Metadata = {
  title: "Alaia Homes Dev",
  description: "Construction project management for home developers.",
  // public/manifest.json + public/sw.js make this installable as a PWA
  // (an icon on the home screen, standalone window, no browser chrome) and
  // able to receive push notifications — see
  // components/PushNotificationToggle.tsx for the opt-in flow.
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Alaia Homes" },
};

export const viewport: Viewport = {
  themeColor: "#1D63C4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <BackgroundTasksProvider>{children}</BackgroundTasksProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
