# Bug list (state at tag `v0-broken`)

Jotpad was written on purpose to look like a typical AI-generated Next.js + Supabase + Stripe MVP: it looks fine
on localhost with a single user and breaks as soon as it meets real users, a real deploy or Stripe. I wrote it
myself for this case study. It is not anyone's client code.

Each bug has a reproduction. At tag `v0-broken` most are tests marked `test.fails` in `tests/`: they pass while
the bug is there. Each fix commit flips them to normal tests and adds tests for the new behaviour. All six bugs
are fixed on `main`; the "Fixed" line under each bug says how.

## 1. Auth redirect loop on /login

- **Where:** `src/proxy.ts`
- **Symptom:** a signed-out visitor opening any page ends up with `ERR_TOO_MANY_REDIRECTS`. The landing page is
  locked too.
- **Cause:** the matcher runs the proxy on every route, and the only exception is paths starting with `/auth`.
  The login page lives at `/login`, so `/login` redirects to `/login`. The redirect is also a fresh
  `NextResponse`, so any refreshed Supabase session cookies set in `setAll` are dropped on the way out.
- **Repro:** `tests/proxy.test.ts` ("a signed-out visitor can open /login", "... the landing page"), or
  against `npm start`:

  ```
  $ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/login
  307 http://localhost:3000/login
  $ curl -sL --max-redirs 10 -o /dev/null -w "redirects=%{num_redirects}\n" http://localhost:3000/login
  redirects=10
  ```

- **Fixed in "Fix 1":** an explicit list of protected routes (`/dashboard`), send signed-in users away from `/login`,
  keep the session cookies on redirects, and leave `/api/stripe/webhook` out of the matcher. `?next=` goes through `safeNextPath`, so it can't be used
  as an open redirect.

## 2. Row Level Security that lets everyone read everything

- **Where:** `supabase/migrations/20261106000000_init.sql`
- **Symptom:** the dashboard lists every user's notes. Anyone with the public anon key (it ships in the browser
  bundle) can `select * from notes` with no login at all, and can insert notes into another user's account.
- **Cause:** RLS is enabled, but the policies are the dashboard templates: select `using (true)` and insert
  `with check (true)`. The page query has no `user_id` filter because it trusts RLS to do it.
- **Repro:** `tests/rls.test.ts` runs the real migration in Postgres (PGlite) with Supabase's roles and
  `auth.uid()`: "a user cannot read another user's notes", "an anonymous visitor cannot read any notes",
  "a user cannot insert a note owned by another user".
- **Fixed in "Fix 2":** a new migration that replaces the policies with `auth.uid() = user_id` for select, insert,
  update and delete, scoped `to authenticated`, plus an index on `(user_id, created_at)`.

## 3. Stripe webhook that never upgrades anyone and trusts anybody

- **Where:** `src/app/api/stripe/webhook/route.ts`, `src/proxy.ts`
- **Symptom:** after a successful test payment the user stays on the free plan. Stripe's dashboard shows the
  webhook deliveries getting a 307. Meanwhile anyone can `curl` a fake `checkout.session.completed` event at the
  endpoint.
- **Cause:** three problems stacked on each other.
  1. The proxy redirects Stripe (no session cookie) to `/login`, so the handler never runs.
  2. The handler does `JSON.parse(body)` and never checks the `Stripe-Signature` header.
  3. It writes with the cookie-based Supabase client. Stripe has no session, so the update runs as `anon`, RLS
     matches 0 rows, and Supabase returns no error. The `error` result is ignored anyway.
- **Repro:** `curl -X POST http://localhost:3000/api/stripe/webhook` answers `307 → /login`;
  `tests/proxy.test.ts` ("Stripe can reach the webhook without a session"),
  `tests/webhook.test.ts` ("rejects an event without a valid Stripe signature"), and in `tests/rls.test.ts`
  "an update without a user session changes nothing".
- **Fixed in "Fix 3":** `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET` on the raw body (400 on
  a missing or bad signature), a `server-only` service-role client for the plan update, and a 500 when the
  update errors or matches no row, so Stripe retries. Only a paid `checkout.session.completed` upgrades anyone.
  Setting `plan = 'pro'` is idempotent, so duplicate deliveries are harmless. Plus the matcher change from bug 1.
  `tests/webhook.test.ts` signs events with Stripe's own `generateTestHeaderString`.

## 4. Missing env vars on deploy: cryptic build crash or a blank page

- **Where:** `src/lib/supabase/*.ts`, `src/proxy.ts`, `src/app/api/checkout/route.ts`
- **Symptom:** works locally with `.env.local`, fails on Netlify/Vercel where nobody added the variables.
  The build dies with `Neither apiKey nor config.authenticator provided` (Stripe, created at module load) or
  `@supabase/ssr: Your project's URL and API key are required` while prerendering `/login`. `NEXT_PUBLIC_*`
  values are inlined at build time, so adding them later in the hosting UI does nothing until a rebuild. When a
  value is missing or wrong at runtime there is no error boundary, so the user gets a white "Application error"
  page.
- **Cause:** `process.env.X!` non-null assertions everywhere. Nothing checks the config in one place, and
  nothing tells you which variable is missing.
- **Repro:** `npm run build` with no `.env.local` (both errors above are copied from real runs of the broken app).
- **Fixed in "Fix 4":** one `src/lib/env.ts` that validates the variables and names the missing ones,
  `next.config.ts` running that check at the start of a production build, a lazy Stripe client, `.env.example`
  that lists all of them, and `error.tsx` / `global-error.tsx` / `not-found.tsx`. To be clear about what this
  does: a deploy without the variables still fails. It now fails in the first second with
  `Missing environment variables: NEXT_PUBLIC_SUPABASE_URL, ... redeploy after adding them`, instead of a
  library error during prerendering or a blank page in production.

## 5. No loading, empty or error states

- **Where:** `src/app/dashboard/page.tsx`, `src/components/*.tsx`
- **Symptom:** when a query fails the dashboard says "No notes yet." and the user thinks their data is gone.
  Clicking "Add note" twice creates two notes. A failed insert or delete is only `console.log`-ed, and the form
  clears anyway so the text is lost. "Upgrade to Pro" does nothing visible for a few seconds, and if checkout
  fails it navigates to `undefined`.
- **Cause:** `const { data } = await supabase...` with `error` ignored, no pending state on buttons, no
  `loading.tsx` / `error.tsx`, and `fetch` results used without checking `res.ok`.
- **Repro:** read the code at `v0-broken`; the fixed behaviour is covered by `tests/actions.test.ts` and
  `tests/checkout.test.ts`.
- **Fixed in "Fix 5":** the dashboard throws on query errors (so `error.tsx` shows with a retry button),
  `dashboard/loading.tsx` skeleton, add and delete go through server actions with server-side validation,
  pending buttons and inline errors, and the form only clears after the note is saved. The upgrade button checks
  `res.ok` and shows the error; `/api/checkout` answers 409 for Pro users and 502 when Stripe fails. After
  checkout the dashboard polls a few times until the webhook has set the plan.

## 6. Paywall that only exists in the UI

- **Where:** `supabase/migrations/20261106000000_init.sql`, `src/components/note-form.tsx`
- **Symptom:** a free user can make themselves Pro from the browser console:
  `supabase.from('profiles').update({ plan: 'pro' }).eq('id', myId)`. They can also skip the 3-note limit by
  calling `insert` directly.
- **Cause:** the "Users can update own profile" policy covers every column, `plan` included. The 3-note limit is
  an `if` in the React form, so the database accepts as many notes as you send.
- **Repro:** `tests/rls.test.ts` ("a user cannot upgrade their own plan with the anon key", "a free user cannot
  store more than 3 notes").
- **Fixed in "Fix 6":** drop the update policy on `profiles` (only the service role changes `plan`) and enforce
  the limit in the insert policy through the `security definer` function `can_add_note()`, so the limit holds no
  matter which client writes. A per-user advisory lock stops two simultaneous inserts from both passing at 2
  notes. (PGlite has a single connection, so that race is reasoned about, not tested.)

## Found later by the end-to-end run

These two were in the "fixed" code and only showed up when `npm run e2e` drove the app in a real browser.

- **"Try again" didn't recover.** `error.tsx` called `reset()`, which clears the boundary and renders the same
  failed server result again. It now calls `retry()` (stable in Next.js 16.3), which fetches the page again.
  The E2E outage step checks that the notes come back.
- **Sign-out could switch origins.** The auth routes redirected to `new URL("/login", request.url)`. Under
  `next start` that URL carries the server's own hostname (`localhost`), so a browser on `127.0.0.1` or behind
  a proxy landed on another origin without its cookies. They now send a relative `Location`
  (`tests/auth-routes.test.ts`), and the E2E run checks the session cookies are gone after sign-out.
