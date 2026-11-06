import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

let stripe: Stripe | undefined;

/**
 * Created on first use, not at import time: a module-level `new Stripe(undefined)` crashes
 * `next build` on any machine that doesn't have the secret key (see BUGS.md, bug 4).
 */
export function getStripe(): Stripe {
  if (!stripe) {
    stripe = new Stripe(serverEnv("STRIPE_SECRET_KEY"));
  }
  return stripe;
}
