"use client";

import "./globals.css";

/** Last-resort boundary for errors in the root layout itself. It replaces the whole document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-4">
        <main role="alert" className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">Jotpad is having trouble loading</h1>
          <p className="text-sm text-stone-700">Please try again in a moment.</p>
          {error.digest && <p className="font-mono text-xs text-stone-500">Error id: {error.digest}</p>}
          <button
            type="button"
            onClick={retry}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
