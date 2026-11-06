import { beforeEach, describe, expect, test, vi } from "vitest";

let user: { id: string; email: string } | null;
let profile: { data: { plan: string } | null; error: { message: string } | null };
const createSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => profile }) }) }),
  }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: createSession } } }),
}));

const { POST } = await import("@/app/api/checkout/route");

const startCheckout = () => POST(new Request("http://localhost:3000/api/checkout", { method: "POST" }));

beforeEach(() => {
  user = { id: "user-1", email: "alice@example.test" };
  profile = { data: { plan: "free" }, error: null };
  createSession.mockReset().mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/checkout", () => {
  test("returns the Stripe Checkout URL for a free user", async () => {
    const res = await startCheckout();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: "user-1",
        success_url: "http://localhost:3000/dashboard?upgraded=1",
      }),
    );
  });

  test("401 without a session", async () => {
    user = null;
    expect((await startCheckout()).status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  test("409 for a user who is already Pro, so nobody pays twice", async () => {
    profile = { data: { plan: "pro" }, error: null };
    expect((await startCheckout()).status).toBe(409);
    expect(createSession).not.toHaveBeenCalled();
  });

  // Fixed BUG 5: a Stripe failure used to send the browser to `undefined`.
  test("a Stripe failure returns 502 with a message the button can show", async () => {
    createSession.mockRejectedValue(new Error("Invalid API Key provided"));
    const res = await startCheckout();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Payments are unavailable right now. Try again later." });
  });
});
