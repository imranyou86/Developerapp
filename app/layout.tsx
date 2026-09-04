import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { BackgroundTasksProvider } from "@/components/BackgroundTasks";

export const metadata: Metadata = {
  title: "The Developer",
  description: "Construction project management for home developers.",
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
