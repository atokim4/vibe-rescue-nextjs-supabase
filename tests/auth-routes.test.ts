import { beforeEach, describe, expect, test, vi } from "vitest";

const signOut = vi.fn(async () => ({ error: null }));
let exchangeError: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signOut,
      exchangeCodeForSession: async () => ({ error: exchangeError }),
    },
  }),
}));

const { POST: signout } = await import("@/app/auth/signout/route");
const { GET: callback } = await import("@/app/auth/callback/route");

beforeEach(() => {
  signOut.mockClear();
  exchangeError = null;
});

describe("auth routes redirect relative to the host the browser used", () => {
  test("sign out ends the session and sends the user to /login", async () => {
    const res = await signout();
    expect(signOut).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
  });

  test("a valid confirmation code continues to the requested page", async () => {
    const res = await callback(new Request("http://localhost:3000/auth/callback?code=abc&next=/dashboard"));
    expect(res.headers.get("location")).toBe("/dashboard");
  });

  test("next can't point at another site", async () => {
    const res = await callback(new Request("http://localhost:3000/auth/callback?code=abc&next=//evil.example"));
    expect(res.headers.get("location")).toBe("/dashboard");
  });

  test("a failed or missing code shows the confirmation error", async () => {
    exchangeError = { message: "expired" };
    const failed = await callback(new Request("http://localhost:3000/auth/callback?code=old"));
    expect(failed.headers.get("location")).toBe("/login?error=confirmation_failed");

    const missing = await callback(new Request("http://localhost:3000/auth/callback"));
    expect(missing.headers.get("location")).toBe("/login?error=confirmation_failed");
  });
});
