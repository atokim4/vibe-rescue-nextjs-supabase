import { describe, expect, test } from "vitest";
import { BODY_MAX, TITLE_MAX, insertErrorMessage, parseNoteInput } from "@/lib/notes";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parseNoteInput", () => {
  test("trims the title and body", () => {
    expect(parseNoteInput(form({ title: "  Groceries ", body: " milk \n" }))).toEqual({
      ok: true,
      value: { title: "Groceries", body: "milk" },
    });
  });

  test("the body is optional", () => {
    expect(parseNoteInput(form({ title: "Just a title" }))).toEqual({
      ok: true,
      value: { title: "Just a title", body: "" },
    });
  });

  test.each([
    [{ title: "   " }, /title/],
    [{ title: "x".repeat(TITLE_MAX + 1) }, /under 120/],
    [{ title: "ok", body: "x".repeat(BODY_MAX + 1) }, /under 5000/],
  ])("rejects %#", (fields, message) => {
    const result = parseNoteInput(form(fields));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(message);
  });
});

describe("insertErrorMessage", () => {
  test("a policy rejection is explained as the plan limit", () => {
    expect(insertErrorMessage({ code: "42501" })).toMatch(/free plan holds 3 notes/);
  });

  test("anything else is a generic retry message", () => {
    expect(insertErrorMessage({ code: "08006" })).toMatch(/try again/);
  });
});
