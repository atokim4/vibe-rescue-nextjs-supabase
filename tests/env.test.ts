import { afterEach, describe, expect, test, vi } from "vitest";
import { MissingEnvError, publicEnv, requireEnv, serverEnv } from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("env", () => {
  test("returns the values when everything is set", () => {
    expect(requireEnv({ A: "1", B: "2" })).toEqual({ A: "1", B: "2" });
  });

  // Fixed BUG 4: `process.env.X!` failed far away from the cause with an unrelated library error.
  test("one error names every missing or blank variable", () => {
    let error: unknown;
    try {
      requireEnv({ SET: "ok", MISSING: undefined, BLANK: "  " });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MissingEnvError);
    expect((error as MissingEnvError).missing).toEqual(["MISSING", "BLANK"]);
    expect((error as Error).message).toMatch(/^Missing environment variables: MISSING, BLANK\./);
  });

  test("a missing NEXT_PUBLIC_ variable comes with the rebuild hint", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY\..*redeploy after adding them/);
  });

  test("a missing server secret is reported by name without the rebuild hint", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(() => serverEnv("STRIPE_WEBHOOK_SECRET")).toThrow(
      "Missing environment variable: STRIPE_WEBHOOK_SECRET. Set it in .env.local or in your hosting provider's settings (see .env.example).",
    );
  });

  test("reads server secrets that are set", () => {
    expect(serverEnv("STRIPE_SECRET_KEY")).toBe("sk_test_dummy");
  });
});
