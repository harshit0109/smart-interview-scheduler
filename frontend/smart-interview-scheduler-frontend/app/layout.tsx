import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "Smart Interview Scheduler | Explainable AI-Assisted Scheduling",
  description:
    "Don't just schedule an interview. Explain why this is the best possible interview slot. AI-assisted interview coordination with deterministic, explainable scheduling.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
