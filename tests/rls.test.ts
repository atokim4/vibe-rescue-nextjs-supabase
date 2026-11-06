import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "vitest";
import { as, createTestDatabase, createUser } from "./db";

// Tests marked "Fixed BUG n" reproduced that bug from BUGS.md as `test.fails` at tag `v0-broken`;
// the fix commit flipped them to normal tests.

let db: PGlite;
let alice: string;
let bob: string;

beforeEach(async () => {
  db = await createTestDatabase();
  alice = await createUser(db, "alice@example.test");
  bob = await createUser(db, "bob@example.test");
  await as(db, { role: "authenticated", userId: bob }, (tx) =>
    tx.query("insert into public.notes (title, body) values ('Bob private', 'sample secret')"),
  );
});

function insertNote(userId: string, title: string) {
  return as(db, { role: "authenticated", userId }, (tx) =>
    tx.query("insert into public.notes (title) values ($1)", [title]),
  );
}

describe("notes", () => {
  test("a signed-in user can add and read their own notes", async () => {
    const rows = await as(db, { role: "authenticated", userId: alice }, async (tx) => {
      await tx.query("insert into public.notes (title) values ('Alice note')");
      return (await tx.query<{ title: string }>("select title from public.notes where user_id = $1", [alice])).rows;
    });
    expect(rows.map((r) => r.title)).toEqual(["Alice note"]);
  });

  // Fixed BUG 2: the select policy was `using (true)`, so every user saw every note.
  test("a user cannot read another user's notes", async () => {
    const { rows } = await as(db, { role: "authenticated", userId: alice }, (tx) =>
      tx.query("select * from public.notes"),
    );
    expect(rows).toHaveLength(0);
  });

  // Fixed BUG 2: anyone holding the public anon key could read everything.
  test("an anonymous visitor cannot read any notes", async () => {
    const { rows } = await as(db, { role: "anon" }, (tx) => tx.query("select * from public.notes"));
    expect(rows).toHaveLength(0);
  });

  // Fixed BUG 2: the insert policy was `with check (true)`, so a user could write rows owned by someone else.
  test("a user cannot insert a note owned by another user", async () => {
    await expect(
      as(db, { role: "authenticated", userId: alice }, (tx) =>
        tx.query("insert into public.notes (user_id, title) values ($1, 'planted')", [bob]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  test("a user cannot edit or delete another user's notes", async () => {
    const changed = await as(db, { role: "authenticated", userId: alice }, async (tx) => {
      const updated = await tx.query("update public.notes set title = 'hacked'");
      const deleted = await tx.query("delete from public.notes");
      return (updated.affectedRows ?? 0) + (deleted.affectedRows ?? 0);
    });
    expect(changed).toBe(0);
    const { rows } = await db.query<{ title: string }>("select title from public.notes");
    expect(rows.map((r) => r.title)).toEqual(["Bob private"]);
  });
});

describe("profiles and plan", () => {
  test("signing up creates a free profile", async () => {
    const { rows } = await db.query<{ plan: string }>("select plan from public.profiles where id = $1", [alice]);
    expect(rows[0].plan).toBe("free");
  });

  // Fixed BUG 6: "Users can update own profile" covered every column, `plan` included.
  test("a user cannot upgrade their own plan with the anon key", async () => {
    await as(db, { role: "authenticated", userId: alice }, (tx) =>
      tx.query("update public.profiles set plan = 'pro' where id = $1", [alice]),
    ).catch(() => undefined);
    const { rows } = await db.query<{ plan: string }>("select plan from public.profiles where id = $1", [alice]);
    expect(rows[0].plan).toBe("free");
  });

  // Fixed BUG 6: the 3-note limit only existed in the React form, so the API accepted a 4th note.
  test("a free user cannot store more than 3 notes", async () => {
    for (const title of ["one", "two", "three"]) await insertNote(alice, title);
    await expect(insertNote(alice, "four")).rejects.toThrow(/row-level security/);
  });

  test("deleting a note frees a slot on the free plan", async () => {
    for (const title of ["one", "two", "three"]) await insertNote(alice, title);
    await as(db, { role: "authenticated", userId: alice }, (tx) =>
      tx.query("delete from public.notes where title = 'one'"),
    );
    await expect(insertNote(alice, "four")).resolves.toBeDefined();
  });

  test("another user's notes don't count towards your limit", async () => {
    for (const title of ["one", "two"]) await insertNote(bob, title);
    for (const title of ["one", "two", "three"]) await insertNote(alice, title);
    const { rows } = await db.query("select 1 from public.notes where user_id = $1", [alice]);
    expect(rows).toHaveLength(3);
  });

  test("a Pro user can store more than 3 notes", async () => {
    await as(db, { role: "service_role" }, (tx) =>
      tx.query("update public.profiles set plan = 'pro' where id = $1", [alice]),
    );
    for (const title of ["one", "two", "three", "four", "five"]) await insertNote(alice, title);
    const { rows } = await db.query("select 1 from public.notes where user_id = $1", [alice]);
    expect(rows).toHaveLength(5);
  });

  test("the limit check can't be called by anonymous visitors", async () => {
    await expect(as(db, { role: "anon" }, (tx) => tx.query("select public.can_add_note()"))).rejects.toThrow(
      /permission denied/,
    );
  });

  // Explains BUG 3: the webhook has no user session, so it talks to Postgres as `anon` and matches 0 rows.
  test("an update without a user session changes nothing", async () => {
    const result = await as(db, { role: "anon" }, (tx) =>
      tx.query("update public.profiles set plan = 'pro' where id = $1", [alice]),
    );
    expect(result.affectedRows).toBe(0);
  });

  test("the service role can set the plan (what a webhook should use)", async () => {
    const result = await as(db, { role: "service_role" }, (tx) =>
      tx.query("update public.profiles set plan = 'pro' where id = $1", [alice]),
    );
    expect(result.affectedRows).toBe(1);
  });
});
