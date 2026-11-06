import { beforeEach, describe, expect, test, vi } from "vitest";

// A tiny stand-in for the Supabase query builder: records each call and resolves to `result`.
type Result = { data?: unknown; error: { code?: string; message: string } | null };
let user: { id: string } | null;
let result: Result;
const calls: unknown[][] = [];

function builder(): unknown {
  const target = {
    then: (resolve: (r: Result) => unknown) => resolve(result),
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === "then") return obj.then;
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        return builder();
      };
    },
  });
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      calls.push(["from", table]);
      return builder();
    },
  }),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { addNote, deleteNote } = await import("@/app/dashboard/actions");

function noteForm(title: string, body = "") {
  const data = new FormData();
  data.set("title", title);
  data.set("body", body);
  return data;
}

beforeEach(() => {
  user = { id: "user-1" };
  result = { data: [], error: null };
  calls.length = 0;
  revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addNote", () => {
  test("saves the trimmed note for the signed-in user and refreshes the dashboard", async () => {
    await expect(addNote(noteForm(" Hello ", "world"))).resolves.toEqual({ ok: true });
    expect(calls).toContainEqual(["insert", { title: "Hello", body: "world", user_id: "user-1" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("invalid input never reaches the database", async () => {
    await expect(addNote(noteForm("  "))).resolves.toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  test("an expired session gets a sign-in message", async () => {
    user = null;
    await expect(addNote(noteForm("Hello"))).resolves.toEqual({
      ok: false,
      error: "Your session has expired. Sign in again.",
    });
  });

  // Fixed BUG 5: the old form only console.log-ed a failed insert and cleared the input anyway.
  test("a database error comes back as a message, not a silent success", async () => {
    result = { error: { code: "08006", message: "connection failure" } };
    const outcome = await addNote(noteForm("Hello"));
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/try again/) });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("the database's plan limit is reported as such", async () => {
    result = { error: { code: "42501", message: "new row violates row-level security policy" } };
    await expect(addNote(noteForm("Fourth"))).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/Upgrade to Pro/),
    });
  });
});

describe("deleteNote", () => {
  test("deletes only the signed-in user's note", async () => {
    result = { data: [{ id: "note-1" }], error: null };
    await expect(deleteNote("note-1")).resolves.toEqual({ ok: true });
    expect(calls).toContainEqual(["eq", "id", "note-1"]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
  });

  test("a delete that matched nothing says so", async () => {
    result = { data: [], error: null };
    await expect(deleteNote("gone")).resolves.toEqual({ ok: false, error: "That note no longer exists." });
  });

  test("a failed delete is reported", async () => {
    result = { data: null, error: { message: "timeout" } };
    await expect(deleteNote("note-1")).resolves.toMatchObject({ ok: false });
  });
});
