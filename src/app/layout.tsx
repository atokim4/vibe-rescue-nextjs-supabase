import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jotpad",
  description: "Private notes with a Pro plan. Sample app for a Next.js + Supabase + Stripe rescue case study.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Jotpad
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-stone-200 py-4 text-center text-xs text-stone-500">
          Sample app with sample data, built by Sunnatulla as a personal portfolio project.
        </footer>
      </body>
    </html>
  );
}
