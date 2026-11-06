import { describe, expect, test } from "vitest";
import { safeNextPath } from "@/lib/safe-next-path";

describe("safeNextPath", () => {
  test("keeps local paths with a query", () => {
    expect(safeNextPath("/dashboard?upgraded=1")).toBe("/dashboard?upgraded=1");
  });

  test.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "dashboard"])(
    "falls back for %s",
    (value) => {
      expect(safeNextPath(value)).toBe("/dashboard");
    },
  );
});
