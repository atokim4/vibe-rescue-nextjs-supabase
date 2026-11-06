import Stripe from "stripe";
import { beforeEach, describe, expect, test, vi } from "vitest";

type UpdateResult = { data: { id: string }[] | null; error: { message: string } | null };

const update = vi.fn();
let updateResult: UpdateResult;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: (column: string, value: unknown) => ({
          select: async () => {
            update({ table, values, where: { [column]: value } });
            return updateResult;
          },
        }),
      }),
    }),
  }),
}));

const { POST } = await import("@/app/api/stripe/webhook/route");

const secret = "whsec_test_dummy";
const stripe = new Stripe("sk_test_dummy");

function checkoutEvent(session: Partial<Stripe.Checkout.Session>, type = "checkout.session.completed") {
  return {
    id: "evt_test_1",
    object: "event",
    type,
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        client_reference_id: "user-1",
        customer: "cus_test_1",
        payment_status: "paid",
        ...session,
      },
    },
  };
}

function deliver(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  const headers = new Headers();
  if (signature !== undefined) headers.set("stripe-signature", signature);
  return POST(new Request("http://localhost:3000/api/stripe/webhook", { method: "POST", body, headers }));
}

/** Signs the payload the same way Stripe does, with the endpoint's webhook secret. */
function deliverSigned(payload: unknown, signingSecret = secret) {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: JSON.stringify(payload),
    secret: signingSecret,
  });
  return deliver(payload, signature);
}

beforeEach(() => {
  update.mockReset();
  updateResult = { data: [{ id: "user-1" }], error: null };
});

describe("Stripe webhook", () => {
  // Fixed BUG 3: the payload was trusted without checking the Stripe-Signature header,
  // so anyone could POST a fake "payment succeeded" event and get Pro for free.
  test("rejects an event without a Stripe signature", async () => {
    const res = await deliver(checkoutEvent({}));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  test("rejects an event signed with the wrong secret", async () => {
    const res = await deliverSigned(checkoutEvent({}), "whsec_attacker");
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  test("rejects a body changed after signing", async () => {
    const signed = checkoutEvent({});
    const signature = stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(signed), secret });
    const res = await deliver(checkoutEvent({ client_reference_id: "attacker" }), signature);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  test("a signed, paid checkout upgrades the user with the service-role client", async () => {
    const res = await deliverSigned(checkoutEvent({}));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      table: "profiles",
      values: { plan: "pro", stripe_customer_id: "cus_test_1" },
      where: { id: "user-1" },
    });
  });

  test("an unpaid checkout (e.g. a delayed payment method) does not upgrade anyone", async () => {
    const res = await deliverSigned(checkoutEvent({ payment_status: "unpaid" }));
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });

  test("other event types are acknowledged and ignored", async () => {
    const res = await deliverSigned(checkoutEvent({}, "checkout.session.expired"));
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });

  // Fixed BUG 3: the broken handler ignored the update result and always answered 200.
  test("a database error answers 500 so Stripe retries the delivery", async () => {
    updateResult = { data: null, error: { message: "connection refused" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await deliverSigned(checkoutEvent({}));
    expect(res.status).toBe(500);
  });

  test("an update that matches no profile answers 500 instead of failing silently", async () => {
    updateResult = { data: [], error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await deliverSigned(checkoutEvent({}));
    expect(res.status).toBe(500);
  });
});

describe("Stripe webhook configuration", () => {
  test("answers 500 with a clear log line when STRIPE_WEBHOOK_SECRET is missing", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await deliverSigned(checkoutEvent({}));
    vi.unstubAllEnvs();
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("STRIPE_WEBHOOK_SECRET"));
    expect(update).not.toHaveBeenCalled();
  });
});
