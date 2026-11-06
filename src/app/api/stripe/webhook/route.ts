import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { MissingEnvError, serverEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe calls this after Checkout. The proxy is not in front of it (see `src/proxy.ts`), so the only proof
 * that a request comes from Stripe is the `Stripe-Signature` header checked against the raw body.
 *
 * Status codes matter here: 400 tells Stripe the request itself is bad (don't retry), 500 tells it to retry
 * later, 200 means handled. Setting `plan = 'pro'` is idempotent, so a duplicate delivery is harmless.
 */
export async function POST(request: Request) {
  let secret: string;
  try {
    secret = serverEnv("STRIPE_WEBHOOK_SECRET");
  } catch (error) {
    if (!(error instanceof MissingEnvError)) throw error;
    console.error(`Stripe webhook: ${error.message}`);
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe-Signature header" }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object;
  const userId = session.client_reference_id;
  if (session.payment_status !== "paid" || !userId) {
    return NextResponse.json({ received: true, ignored: "unpaid or anonymous session" });
  }

  const customerId = typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  const { data, error } = await createAdminClient()
    .from("profiles")
    .update({ plan: "pro", stripe_customer_id: customerId })
    .eq("id", userId)
    .select("id");

  // The broken version ignored this result, so a failed or 0-row update still answered 200.
  if (error || !data?.length) {
    console.error("Stripe webhook: plan update failed", {
      eventId: event.id,
      error: error?.message ?? "no profile row",
    });
    return NextResponse.json({ error: "Could not update the plan" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
