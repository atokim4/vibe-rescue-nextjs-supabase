// Reproduces the bugs against the running broken version (tag v0-broken) and prints a transcript.
//
// It checks the tag out into a temporary git worktree, applies the broken migrations to the local Supabase
// stand-in, builds and starts that app, then makes the same requests a browser, Stripe or a curious user would.
// Every line says what happened; the run fails if a bug doesn't reproduce, so the transcript can't go stale.
//
// Usage: npm run e2e:before

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalSupabase } from "./local-supabase.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = Number(process.env.APP_PORT ?? 3200);
const SUPABASE_PORT = Number(process.env.SUPABASE_PORT ?? 54330);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PASSWORD = "sample-password-1";

const log = (text) => console.log(text);
const row = (request, result) => log(`${request.padEnd(42)} → ${result}`);

function git(...args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      await fetch(url, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`${url} did not come up in ${timeoutMs} ms`);
}

async function signIn(supabase, email) {
  const res = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await res.json()).access_token;
}

async function main() {
  const workdir = mkdtempSync(path.join(tmpdir(), "jotpad-v0-broken-"));
  const appDir = path.join(workdir, "app");
  git("worktree", "add", "--detach", appDir, "v0-broken");
  symlinkSync(path.join(ROOT, "node_modules"), path.join(appDir, "node_modules"));

  const supabase = await startLocalSupabase({
    port: SUPABASE_PORT,
    migrationsDir: path.join(appDir, "supabase", "migrations"),
    // The shim is test infrastructure, not part of the app, so the current one is used for both versions.
    shimFile: path.join(ROOT, "tests", "supabase-shim.sql"),
  });
  const alice = await supabase.createUser("alice@example.test", PASSWORD);
  await supabase.addNotes(alice.id, [{ title: "Alice's sample note", body: "Only Alice should see this." }]);
  const bob = await supabase.createUser("bob@example.test", PASSWORD);

  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: supabase.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    STRIPE_SECRET_KEY: "sk_test_local_e2e_not_a_real_key",
    STRIPE_WEBHOOK_SECRET: "whsec_local_e2e_only",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const next = path.join(ROOT, "node_modules", ".bin", "next");
  let server;

  try {
    log("Building v0-broken against the local Supabase stand-in…");
    // Webpack, not Turbopack: Turbopack refuses the symlinked node_modules outside the temporary worktree.
    const build = spawnSync(next, ["build", "--webpack"], { cwd: appDir, env, encoding: "utf8" });
    assert.equal(build.status, 0, `next build failed:\n${build.stdout}\n${build.stderr}`);
    server = spawn(next, ["start", "-p", String(APP_PORT), "-H", "127.0.0.1"], { cwd: appDir, env, stdio: "ignore" });
    await waitForHttp(BASE);

    log("\n# Bug 1: redirect loop");
    const login = await fetch(`${BASE}/login`, { redirect: "manual" });
    row(
      "GET /login (signed out)",
      `${login.status} Location: ${new URL(login.headers.get("location"), BASE).pathname}`,
    );
    assert.equal(new URL(login.headers.get("location"), BASE).pathname, "/login");
    const home = await fetch(`${BASE}/`, { redirect: "manual" });
    row("GET / (signed out)", `${home.status} Location: ${new URL(home.headers.get("location"), BASE).pathname}`);
    assert.equal(home.status, 307);

    log("\n# Bug 2: RLS lets everyone read and write everything");
    const anonNotes = await fetch(`${supabase.url}/rest/v1/notes?select=title`, {
      headers: { apikey: supabase.anonKey, authorization: `Bearer ${supabase.anonKey}` },
    }).then((res) => res.json());
    row("anon key, select notes", JSON.stringify(anonNotes));
    assert.equal(anonNotes.length, 1);
    const bobToken = await signIn(supabase, "bob@example.test");
    const asBob = { apikey: supabase.anonKey, authorization: `Bearer ${bobToken}`, "content-type": "application/json" };
    const planted = await fetch(`${supabase.url}/rest/v1/notes`, {
      method: "POST",
      headers: asBob,
      body: JSON.stringify({ user_id: alice.id, title: "Planted by Bob", body: "" }),
    });
    row("Bob inserts a note owned by Alice", String(planted.status));
    assert.equal(planted.status, 201);

    log("\n# Bug 3: the webhook never runs and trusts anyone");
    const forged = await fetch(`${BASE}/api/stripe/webhook`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: bob.id } } }),
    });
    row(
      "POST /api/stripe/webhook, no signature",
      `${forged.status} Location: ${new URL(forged.headers.get("location"), BASE).pathname}`,
    );
    assert.equal(forged.status, 307);

    log("\n# Bug 6: the paywall is only in the UI");
    const upgraded = await fetch(`${supabase.url}/rest/v1/profiles?id=eq.${bob.id}&select=plan`, {
      method: "PATCH",
      headers: { ...asBob, prefer: "return=representation" },
      body: JSON.stringify({ plan: "pro" }),
    }).then((res) => res.json());
    row('Bob sets his own plan to "pro"', `${JSON.stringify(upgraded)}`);
    assert.deepEqual(upgraded, [{ plan: "pro" }]);

    log("\nAll four reproduced. Bugs 4 and 5 are about missing env and failures; see BUGS.md.");
  } finally {
    server?.kill("SIGTERM");
    await supabase.stop();
    git("worktree", "remove", "--force", appDir);
    rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
