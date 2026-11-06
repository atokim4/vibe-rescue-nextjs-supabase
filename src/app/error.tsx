"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown instead of a blank "Application error" page when a route throws. */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section role="alert" className="mx-auto max-w-md space-y-4 rounded-lg border border-red-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-stone-700">
        The page couldn&apos;t load. Your notes are safe; this is a problem on our side or with the connection.
      </p>
      {/* In production Next.js hides server error messages and sends only this id, which matches the server log. */}
      {error.digest && <p className="font-mono text-xs text-stone-500">Error id: {error.digest}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Try again
        </button>
        <Link href="/" className="rounded-md px-4 py-2 text-sm text-stone-700 hover:underline">
          Home
        </Link>
      </div>
    </section>
  );
}
