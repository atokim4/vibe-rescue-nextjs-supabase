// End-to-end run of the fixed app in a real browser, with no cloud accounts.
//
// 1. Starts the local Supabase stand-in (e2e/local-supabase.mjs) with the real migrations and sample users.
// 2. Builds the app against it and starts `next start`.
// 3. Drives headless Chrome through the flows each bug fix is about, asserting as it goes, and saves the
//    README screenshots to docs/screenshots/.
//
// Usage: npm run e2e   (CHROME_PATH defaults to /usr/bin/google-chrome; SKIP_BUILD=1 reuses .next)
// Stripe is not called: the upgrade is driven by a webhook event signed with the test secret, the same
// way `stripe trigger` would deliver it.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import Stripe from "stripe";
import { startLocalSupabase } from "./local-supabase.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "docs", "screenshots");
const APP_PORT = Number(process.env.APP_PORT ?? 3100);
const SUPABASE_PORT = Number(process.env.SUPABASE_PORT ?? 54329);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const WEBHOOK_SECRET = "whsec_local_e2e_only";
const PASSWORD = "sample-password-1";

// Sample data only. The ".test" domain is reserved and never delivers mail.
const ALICE = {
  email: "alice@example.test",
  notes: [{ title: "Alice's sample note", body: "Only Alice should see this." }],
};
const BOB = { email: "bob@example.test" };

const step = (text) => console.log(`- ${text}`);

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

async function main() {
  const supabase = await startLocalSupabase({
    port: SUPABASE_PORT,
    migrationsDir: path.join(ROOT, "supabase", "migrations"),
    shimFile: path.join(ROOT, "tests", "supabase-shim.sql"),
  });
  const alice = await supabase.createUser(ALICE.email, PASSWORD);
  await supabase.addNotes(alice.id, ALICE.notes);
  const bob = await supabase.createUser(BOB.email, PASSWORD);

  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: supabase.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    STRIPE_SECRET_KEY: "sk_test_local_e2e_not_a_real_key",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const next = path.join(ROOT, "node_modules", ".bin", "next");

  if (process.env.SKIP_BUILD !== "1") {
    step("building the app against the local stand-in");
    const build = spawnSync(next, ["build"], { cwd: ROOT, env, stdio: "inherit" });
    assert.equal(build.status, 0, "next build failed");
  }

  const server = spawn(next, ["start", "-p", String(APP_PORT), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: "pipe" });
  const serverLog = [];
  server.stdout.on("data", (chunk) => serverLog.push(chunk.toString()));
  server.stderr.on("data", (chunk) => serverLog.push(chunk.toString()));

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome" });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  // Browser console errors fail the run, except the ones a step causes on purpose (see `expectConsoleErrors`).
  const consoleErrors = [];
  let allowedConsoleError = null;
  page.on("console", (msg) => {
    if (msg.type() !== "error" || allowedConsoleError?.test(msg.text())) return;
    consoleErrors.push(`${msg.text()} (${msg.location().url})`);
  });
  const expectConsoleErrors = async (pattern, action) => {
    allowedConsoleError = pattern;
    try {
      await action();
    } finally {
      allowedConsoleError = null;
    }
  };
  page.on("dialog", (dialog) => dialog.accept());
  const shot = (name, options = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...options });

  try {
    await mkdir(SHOTS, { recursive: true });
    await waitForHttp(BASE);

    // Bug 1: public pages open, protected ones redirect once, with ?next.
    await page.goto(`${BASE}/`);
    await page.getByRole("heading", { name: "Notes that stay yours." }).waitFor();
    await shot("01-landing");
    step("landing page opens signed out");

    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL(`${BASE}/login?next=%2Fdashboard`);
    step("/dashboard signed out → one redirect to /login?next=/dashboard");

    // Wrong password: a readable message, the form stays usable.
    await page.getByLabel("Email").fill(BOB.email);
    await page.getByLabel("Password").fill("wrong-password");
    await expectConsoleErrors(/status of 400/, async () => {
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("status").filter({ hasText: "Invalid login credentials" }).waitFor();
    });
    await shot("02-login-error");
    step("wrong password shows the error from Supabase Auth");

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/dashboard`);
    await page.getByText("No notes yet.").waitFor();
    step("sign in lands on /dashboard");

    // Bug 2: Bob must not see Alice's note.
    assert.equal(await page.getByText(ALICE.notes[0].title).count(), 0, "Bob can see Alice's note");
    step("Bob's empty dashboard does not list Alice's note (RLS)");

    // Bug 1 again: a signed-in user on /login goes to the dashboard instead of looping.
    await page.goto(`${BASE}/login`);
    await page.waitForURL(`${BASE}/dashboard`);
    step("/login signed in → /dashboard");

    // Bug 5: add notes through the server action; the form clears only after saving.
    const sample = [
      ["Groceries", "Rice, carrots, onions, lamb"],
      ["Call the bank", "Ask about the card limit"],
      ["Book idea", "A detective who only works on Sundays"],
    ];
    for (const [title, body] of sample) {
      await page.getByPlaceholder("Title").fill(title);
      await page.getByPlaceholder("Write something…").fill(body);
      await page.getByRole("button", { name: "Add note" }).click();
      await page.getByRole("heading", { name: title }).waitFor();
      assert.equal(
        await page
          .getByPlaceholder("Title")
          .inputValue()
          .catch(() => ""),
        "",
        "form did not clear",
      );
    }
    step("added 3 notes through the form");

    // Bug 6: at 3 notes the form is replaced by the limit message...
    await page.getByText("The free plan holds 3 notes.").waitFor();
    await page.getByText("Free plan (3/3 notes)").waitFor();
    await shot("03-dashboard-limit", { fullPage: true });
    step("limit message at 3/3 notes");

    // ...and the database enforces it too, whatever the client. Same calls a user could make from the console.
    const bobSession = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: supabase.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: BOB.email, password: PASSWORD }),
    }).then((res) => res.json());
    const asBob = {
      apikey: supabase.anonKey,
      authorization: `Bearer ${bobSession.access_token}`,
      "content-type": "application/json",
    };
    const fourth = await fetch(`${supabase.url}/rest/v1/notes`, {
      method: "POST",
      headers: asBob,
      body: JSON.stringify({ user_id: bob.id, title: "Fourth note", body: "" }),
    });
    assert.equal(fourth.status, 403, `direct 4th insert answered ${fourth.status}`);
    const selfUpgrade = await fetch(`${supabase.url}/rest/v1/profiles?id=eq.${bob.id}&select=plan`, {
      method: "PATCH",
      headers: { ...asBob, prefer: "return=representation" },
      body: JSON.stringify({ plan: "pro" }),
    }).then((res) => res.json());
    assert.deepEqual(selfUpgrade, [], "Bob upgraded himself");
    const stolen = await fetch(`${supabase.url}/rest/v1/notes?select=title`, { headers: asBob }).then((res) =>
      res.json(),
    );
    assert.equal(stolen.length, 3, "Bob's token reads notes that aren't his");
    const anon = await fetch(`${supabase.url}/rest/v1/notes?select=title`, {
      headers: { apikey: supabase.anonKey, authorization: `Bearer ${supabase.anonKey}` },
    }).then((res) => res.json());
    assert.deepEqual(anon, [], "the anon key reads notes");
    step("with Bob's own token: 4th insert 403, self-upgrade 0 rows, reads only his 3 notes; anon reads 0");

    // Bug 5: delete with a pending state, then the form comes back.
    await page.getByRole("button", { name: "Delete note: Call the bank" }).click();
    await page.getByRole("heading", { name: "Call the bank" }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add note" }).waitFor();
    step("deleted a note, form is back at 2/3");

    // Bug 5: loading skeleton while the queries are slow.
    supabase.faults.delayMs = 2500;
    await page.goto(`${BASE}/`);
    const navigation = page.goto(`${BASE}/dashboard`, { waitUntil: "commit" });
    await page.getByLabel("Loading your notes").waitFor({ timeout: 5000 });
    await shot("04-loading-skeleton");
    await navigation;
    supabase.faults.delayMs = 0;
    await page.getByRole("heading", { name: "Your notes" }).waitFor();
    step("slow database → loading skeleton, then the notes");

    // Bug 5: the database is down → the error page with a retry, not "No notes yet."
    // React error #441 is the production form of "An error occurred in the Server Components render".
    supabase.faults.restDown = true;
    await expectConsoleErrors(/React error #441/, async () => {
      await page.reload();
      await page.getByRole("heading", { name: "Something went wrong" }).waitFor();
    });
    assert.equal(await page.getByText("No notes yet.").count(), 0);
    await shot("05-error-page");
    supabase.faults.restDown = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("heading", { name: "Groceries" }).waitFor();
    step("database down → error page; Try again recovers once it's back");

    // Bug 3: an unsigned event is rejected, a signed paid checkout upgrades Bob.
    const forged = await fetch(`${BASE}/api/stripe/webhook`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: bob.id } } }),
    });
    assert.equal(forged.status, 400, `forged webhook answered ${forged.status}`);

    const payload = JSON.stringify({
      id: "evt_local_e2e",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_local_e2e",
          object: "checkout.session",
          client_reference_id: bob.id,
          customer: "cus_local_e2e",
          payment_status: "paid",
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const signed = await fetch(`${BASE}/api/stripe/webhook`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    assert.equal(signed.status, 200, `signed webhook answered ${signed.status}`);
    step("webhook: forged event 400, signed paid checkout 200");

    await page.goto(`${BASE}/dashboard?upgraded=1`);
    await page.getByText("You're on Pro now.").waitFor();
    await page.getByText("Pro plan").waitFor();
    await page.getByRole("button", { name: "Add note" }).waitFor();
    await shot("06-pro-after-webhook");
    step("dashboard shows Pro after the webhook");

    // Not found page.
    await expectConsoleErrors(/status of 404/, async () => {
      await page.goto(`${BASE}/no-such-page`);
      await page.getByText("Page not found").waitFor();
    });
    step("unknown URL → not-found page");

    // Sign out ends the session.
    await page.goto(`${BASE}/dashboard`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${BASE}/login`);
    const authCookies = (await page.context().cookies(BASE)).filter((cookie) => cookie.name.startsWith("sb-"));
    assert.deepEqual(authCookies, [], "session cookies survived sign out");
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL(/\/login\?next=/);
    step("sign out → /dashboard redirects to /login again");

    assert.deepEqual(consoleErrors, [], "unexpected browser console errors");
    console.log("\nE2E passed. Screenshots in docs/screenshots/");
  } catch (error) {
    console.error("\nE2E failed. Last server output:\n", serverLog.slice(-20).join(""));
    await shot("failure").catch(() => {});
    throw error;
  } finally {
    await browser.close();
    server.kill("SIGTERM");
    await supabase.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
