// A small local stand-in for the two Supabase services the app talks to: Auth (GoTrue) and the
// REST API (PostgREST). The data lives in an in-process Postgres (PGlite) with the real migrations
// applied, so RLS policies, triggers and the paywall function behave exactly as they do in Supabase.
//
// It covers only the requests Jotpad makes (password sign-in, getUser, sign-out, simple eq filters,
// order, single-row reads, insert/update/delete). It exists so the end-to-end run needs no cloud
// account; it is not a general Supabase emulator and is never used in production.

import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROLES = new Set(["anon", "authenticated", "service_role"]);
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const TABLES = new Set(["notes", "profiles"]);
const TOKEN_TTL_SECONDS = 3600;

// ---------- JWT (HS256, the algorithm Supabase's legacy API keys use) ----------

const b64url = (input) => Buffer.from(input).toString("base64url");

export function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verifyJwt(token, secret) {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (typeof claims.exp === "number" && claims.exp < Date.now() / 1000) return null;
  return ROLES.has(claims.role) ? claims : null;
}

// ---------- database ----------

async function createDatabase(migrationsDir, shimFile) {
  const db = new PGlite();
  await db.exec(readFileSync(shimFile, "utf8"));
  // Credentials and refresh tokens stay in a schema the API roles can't see.
  await db.exec(`
    create schema standin;
    create table standin.credentials (user_id uuid primary key references auth.users (id) on delete cascade, hash text not null);
    create table standin.refresh_tokens (token text primary key, user_id uuid not null references auth.users (id) on delete cascade);
  `);
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  return db;
}

function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

/** Runs `fn` the way PostgREST does: one transaction, the JWT's role, the claims in request.jwt.claims. */
function asRole(db, claims, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${claims.role}`); // role is one of ROLES, checked in verifyJwt
    return fn(tx);
  });
}

// ---------- HTTP helpers ----------

class HttpError extends Error {
  constructor(status, body) {
    super(body.message ?? body.msg ?? "error");
    this.status = status;
    this.body = body;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, { code: "PGRST102", message: "Invalid JSON body" });
  }
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    ...headers,
  });
  res.end(payload);
}

function corsPreflight(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,apikey,content-type,prefer,accept,accept-profile,content-profile,x-client-info,x-supabase-api-version",
    "access-control-max-age": "600",
  });
  res.end();
}

const bearer = (req) => req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? req.headers.apikey ?? "";

// ---------- Auth (GoTrue subset) ----------

function userJson(row) {
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    email_confirmed_at: new Date(0).toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

async function issueSession(db, secret, user) {
  const now = Math.floor(Date.now() / 1000);
  const refreshToken = randomBytes(24).toString("hex");
  await db.query("insert into standin.refresh_tokens (token, user_id) values ($1, $2)", [refreshToken, user.id]);
  const accessToken = signJwt(
    {
      sub: user.id,
      role: "authenticated",
      aud: "authenticated",
      email: user.email,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    },
    secret,
  );
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: TOKEN_TTL_SECONDS,
    expires_at: now + TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    user: userJson(user),
  };
}

async function handleAuth(db, secret, req, res, url) {
  const route = url.pathname.slice("/auth/v1".length);
  const invalid = () =>
    new HttpError(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });

  if (req.method === "POST" && route === "/token") {
    const grant = url.searchParams.get("grant_type");
    const body = await readJson(req);
    if (grant === "password") {
      const { rows } = await db.query(
        "select u.id, u.email, c.hash from auth.users u join standin.credentials c on c.user_id = u.id where u.email = $1",
        [String(body.email ?? "").toLowerCase()],
      );
      if (!rows[0] || !checkPassword(String(body.password ?? ""), rows[0].hash)) throw invalid();
      return send(res, 200, await issueSession(db, secret, rows[0]));
    }
    if (grant === "refresh_token") {
      const { rows } = await db.query(
        "delete from standin.refresh_tokens t using auth.users u where t.token = $1 and u.id = t.user_id returning u.id, u.email",
        [String(body.refresh_token ?? "")],
      );
      if (!rows[0])
        throw new HttpError(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return send(res, 200, await issueSession(db, secret, rows[0]));
    }
    throw new HttpError(400, { code: 400, error_code: "unsupported_grant_type", msg: "Unsupported grant type" });
  }

  if (req.method === "POST" && route === "/signup") {
    // Mirrors a project with "Confirm email" switched on: the account is created, no session is returned.
    const body = await readJson(req);
    const email = String(body.email ?? "").toLowerCase();
    if (!email.includes("@") || String(body.password ?? "").length < 6) {
      throw new HttpError(422, {
        code: 422,
        error_code: "validation_failed",
        msg: "Email and a 6+ character password are required",
      });
    }
    const user = await createUser(db, email, String(body.password));
    return send(res, 200, userJson(user));
  }

  const claims = verifyJwt(bearer(req), secret);
  if (req.method === "GET" && route === "/user") {
    if (claims?.role !== "authenticated")
      throw new HttpError(401, { code: 401, error_code: "bad_jwt", msg: "Invalid JWT" });
    const { rows } = await db.query("select id, email from auth.users where id = $1", [claims.sub]);
    if (!rows[0]) throw new HttpError(403, { code: 403, error_code: "user_not_found", msg: "User not found" });
    return send(res, 200, userJson(rows[0]));
  }

  if (req.method === "POST" && route === "/logout") {
    if (claims?.sub) await db.query("delete from standin.refresh_tokens where user_id = $1", [claims.sub]);
    res.writeHead(204, { "access-control-allow-origin": "*" });
    return res.end();
  }

  throw new HttpError(404, { code: 404, msg: `No auth route ${req.method} ${route}` });
}

async function createUser(db, email, password) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(
      "insert into auth.users (email) values ($1) on conflict do nothing returning id, email",
      [email],
    );
    if (!rows[0])
      throw new HttpError(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    await tx.query("insert into standin.credentials (user_id, hash) values ($1, $2)", [
      rows[0].id,
      hashPassword(password),
    ]);
    return rows[0];
  });
}

// ---------- REST (PostgREST subset) ----------

function column(name) {
  if (!IDENTIFIER.test(name)) throw new HttpError(400, { code: "PGRST100", message: `Bad column name "${name}"` });
  return `"${name}"`;
}

function parseQuery(url) {
  const where = [];
  const values = [];
  let select = "*";
  let order = "";
  for (const [key, raw] of url.searchParams) {
    if (key === "select") {
      select =
        raw === "*"
          ? "*"
          : raw
              .split(",")
              .map((c) => column(c.trim()))
              .join(", ");
    } else if (key === "order") {
      order = raw
        .split(",")
        .map((part) => {
          const [col, dir = "asc", nulls] = part.split(".");
          if (!["asc", "desc"].includes(dir)) throw new HttpError(400, { code: "PGRST100", message: "Bad order" });
          const nullsSql = nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : "";
          return `${column(col)} ${dir}${nullsSql}`;
        })
        .join(", ");
    } else {
      const match = /^eq\.(.*)$/s.exec(raw);
      if (!match) throw new HttpError(400, { code: "PGRST100", message: `Only eq filters are supported (${key})` });
      values.push(match[1]);
      where.push(`${column(key)} = $${values.length}`);
    }
  }
  return { select, order, where, values };
}

function pgErrorToHttp(error) {
  if (!error?.code) throw error;
  // Same status mapping PostgREST uses for the codes this app can hit.
  const status = error.code === "42501" ? 403 : error.code.startsWith("23") ? 409 : 400;
  return new HttpError(status, {
    code: error.code,
    message: error.message,
    details: error.detail ?? null,
    hint: error.hint ?? null,
  });
}

async function handleRest(db, secret, faults, req, res, url) {
  if (faults.delayMs) await new Promise((resolve) => setTimeout(resolve, faults.delayMs));
  if (faults.restDown) throw new HttpError(503, { code: "PGRST000", message: "Database unavailable (simulated)" });
  const table = url.pathname.slice("/rest/v1/".length);
  if (!TABLES.has(table))
    throw new HttpError(404, { code: "PGRST205", message: `Could not find the table 'public.${table}'` });

  const token = bearer(req);
  const claims = verifyJwt(token, secret);
  if (!claims) throw new HttpError(401, { code: "PGRST301", message: "JWT is invalid or expired" });

  const prefer = req.headers.prefer ?? "";
  const wantsRows = prefer.includes("return=representation");
  const wantsObject = (req.headers.accept ?? "").includes("application/vnd.pgrst.object+json");
  const { select, order, where, values } = parseQuery(url);
  const whereSql = where.length ? ` where ${where.join(" and ")}` : "";
  const returning = ` returning ${select}`;

  let sql;
  let params = values;
  if (req.method === "GET") {
    sql = `select ${select} from public.${table}${whereSql}${order ? ` order by ${order}` : ""}`;
  } else if (req.method === "POST") {
    const body = await readJson(req);
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length !== 1) throw new HttpError(400, { code: "PGRST102", message: "Insert exactly one row" });
    const cols = Object.keys(rows[0]);
    params = cols.map((c) => rows[0][c]);
    sql = `insert into public.${table} (${cols.map(column).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})${returning}`;
  } else if (req.method === "PATCH") {
    const body = await readJson(req);
    const cols = Object.keys(body);
    if (!cols.length) throw new HttpError(400, { code: "PGRST102", message: "Nothing to update" });
    const set = cols.map((c, i) => `${column(c)} = $${values.length + i + 1}`).join(", ");
    params = [...values, ...cols.map((c) => body[c])];
    sql = `update public.${table} set ${set}${whereSql}${returning}`;
  } else if (req.method === "DELETE") {
    sql = `delete from public.${table}${whereSql}${returning}`;
  } else {
    throw new HttpError(405, { code: "PGRST117", message: `Unsupported method ${req.method}` });
  }

  let rows;
  try {
    ({ rows } = await asRole(db, claims, (tx) => tx.query(sql, params)));
  } catch (error) {
    throw pgErrorToHttp(error);
  }

  if (req.method !== "GET" && !wantsRows) {
    res.writeHead(req.method === "POST" ? 201 : 204, { "access-control-allow-origin": "*" });
    return res.end();
  }
  if (wantsObject) {
    if (rows.length !== 1) {
      throw new HttpError(406, {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
        details: `The result contains ${rows.length} rows`,
        hint: null,
      });
    }
    return send(res, 200, rows[0]);
  }
  return send(res, req.method === "POST" ? 201 : 200, rows);
}

// ---------- server ----------

/**
 * Starts the stand-in. Returns the URL, the API keys (JWTs signed with a secret made for this run)
 * and helpers to seed sample data and to stop it.
 */
export async function startLocalSupabase({ port = 54321, migrationsDir, shimFile }) {
  const secret = randomBytes(32).toString("hex");
  const db = await createDatabase(migrationsDir, shimFile);
  // Switches the E2E run flips to show the slow and failing paths of the app.
  const faults = { delayMs: 0, restDown: false };
  const keyClaims = (role) => ({ role, iss: "local-supabase", iat: Math.floor(Date.now() / 1000) });
  const anonKey = signJwt(keyClaims("anon"), secret);
  const serviceRoleKey = signJwt(keyClaims("service_role"), secret);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    try {
      if (req.method === "OPTIONS") return corsPreflight(res);
      if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(db, secret, req, res, url);
      if (url.pathname.startsWith("/rest/v1/")) return await handleRest(db, secret, faults, req, res, url);
      throw new HttpError(404, { message: `Not found: ${url.pathname}` });
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, error.body);
      console.error("local-supabase:", error);
      return send(res, 500, { message: "Internal error in the local Supabase stand-in" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    anonKey,
    serviceRoleKey,
    db,
    faults,
    /** Creates a confirmed user with a password; the signup trigger adds the profile row. */
    createUser: (email, password) => createUser(db, email.toLowerCase(), password),
    /** Inserts notes as that user, through RLS, the way the app does. */
    addNotes: (userId, notes) =>
      asRole(db, { sub: userId, role: "authenticated" }, async (tx) => {
        for (const note of notes) {
          await tx.query("insert into public.notes (user_id, title, body) values ($1, $2, $3)", [
            userId,
            note.title,
            note.body,
          ]);
        }
      }),
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}

export const newId = randomUUID;
