"use client";

import { useState } from "react";

export function UpgradeButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upgrade() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data: { url?: string; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Couldn't start the checkout.");
      // Stays pending: the browser is leaving for Stripe.
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the checkout.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={upgrade}
        disabled={pending}
        className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Opening checkout…" : "Upgrade to Pro"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
