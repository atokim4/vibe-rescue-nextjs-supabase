import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();
  if (profileError) {
    console.error("checkout: loading the profile failed", profileError.message);
    return NextResponse.json({ error: "Couldn't start the checkout. Try again." }, { status: 500 });
  }
  if (profile.plan === "pro") {
    return NextResponse.json({ error: "You're already on Pro." }, { status: 409 });
  }

  const origin = new URL(request.url).origin;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: 500,
            product_data: { name: "Jotpad Pro (test mode)" },
          },
        },
      ],
      client_reference_id: user.id,
      customer_email: user.email,
      success_url: `${origin}/dashboard?upgraded=1`,
      cancel_url: `${origin}/dashboard`,
    });
    if (!session.url) throw new Error("Stripe returned a session without a URL");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("checkout: creating the Stripe session failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Payments are unavailable right now. Try again later." }, { status: 502 });
  }
}
