import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "supabase", "migrations");

/** A fresh in-memory Postgres with the Supabase shim and every migration applied in order. */
export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(__dirname, "supabase-shim.sql"), "utf8"));
  const migrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  return db;
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  return rows[0].id;
}

export type DbRole = { role: "anon" } | { role: "authenticated"; userId: string } | { role: "service_role" };

/**
 * Runs `fn` the way PostgREST does for a request carrying the given JWT:
 * inside a transaction, as that database role, with the JWT claims set.
 */
export async function as<T>(db: PGlite, who: DbRole, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = who.role === "authenticated" ? { sub: who.userId, role: who.role } : { role: who.role };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${who.role}`);
    return fn(tx);
  });
}
