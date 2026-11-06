"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const POLL_MS = 2000;
const MAX_POLLS = 10;

/**
 * Stripe redirects back before (or right after) the webhook runs, so the plan can still say "free" for a
 * moment. Re-fetch the page a few times instead of telling a paying user they're on the free plan.
 */
export function UpgradePending() {
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const gaveUp = polls >= MAX_POLLS;

  useEffect(() => {
    if (gaveUp) return;
    const timer = setTimeout(() => {
      router.refresh();
      setPolls((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [polls, gaveUp, router]);

  return (
    <p role="status" className="rounded-md bg-sky-50 p-3 text-sm text-sky-900">
      {gaveUp
        ? "Payment received, but your plan hasn't updated yet. Refresh the page in a minute."
        : "Payment received. Updating your plan…"}
    </p>
  );
}
