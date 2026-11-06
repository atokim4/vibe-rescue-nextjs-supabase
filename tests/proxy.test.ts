import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

const { proxy, config } = await import("@/proxy");

function visit(path: string) {
  return proxy(new NextRequest(new URL(path, "http://localhost:3000")));
}

function location(res: Response): URL | null {
  const value = res.headers.get("location");
  return value ? new URL(value) : null;
}

function signedOut() {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
}

function signedIn() {
  getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "alice@example.test" } }, error: null });
}

beforeEach(() => getUser.mockReset());

describe("proxy (route protection)", () => {
  test("a signed-out visitor is sent from /dashboard to /login and back after sign-in", async () => {
    signedOut();
    const res = await visit("/dashboard?upgraded=1");
    expect(res.status).toBe(307);
    expect(location(res)?.pathname).toBe("/login");
    expect(location(res)?.searchParams.get("next")).toBe("/dashboard?upgraded=1");
  });

  test("a signed-in user can open /dashboard", async () => {
    signedIn();
    expect(location(await visit("/dashboard"))).toBeNull();
  });

  // Fixed BUG 1: /login used to redirect to itself.
  test("a signed-out visitor can open /login", async () => {
    signedOut();
    expect(location(await visit("/login"))).toBeNull();
  });

  test("a signed-in user opening /login goes to /dashboard", async () => {
    signedIn();
    expect(location(await visit("/login"))?.pathname).toBe("/dashboard");
  });

  // Fixed BUG 1: the public landing page was locked behind the login.
  test("a signed-out visitor can open the landing page", async () => {
    signedOut();
    expect(location(await visit("/"))).toBeNull();
  });

  test("/dashboard-like paths outside the app are not protected by accident", async () => {
    signedOut();
    expect(location(await visit("/dashboards-are-cool"))).toBeNull();
  });

  // Fixed BUG 3 (part 1): Stripe has no session cookie, so the proxy must not run on the webhook at all.
  test("the proxy does not run on the Stripe webhook", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: "/api/stripe/webhook" })).toBe(false);
    expect(unstable_doesMiddlewareMatch({ config, url: "/dashboard" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, url: "/api/checkout" })).toBe(true);
  });
});
