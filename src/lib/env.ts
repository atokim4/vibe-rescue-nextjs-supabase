/**
 * One place that knows which environment variables the app needs and says exactly which ones are missing.
 *
 * `NEXT_PUBLIC_*` values must be read as literal `process.env.NEXT_PUBLIC_X` expressions: Next.js inlines
 * them into the browser bundle at build time, so they can't be looked up by a dynamic key.
 */

export const PUBLIC_ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
export const SERVER_ENV_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;

export type ServerEnvVar = (typeof SERVER_ENV_VARS)[number];

export class MissingEnvError extends Error {
  constructor(readonly missing: readonly string[]) {
    const plural = missing.length > 1;
    const publicOnes = missing.some((name) => name.startsWith("NEXT_PUBLIC_"));
    super(
      `Missing environment variable${plural ? "s" : ""}: ${missing.join(", ")}. ` +
        `Set ${plural ? "them" : "it"} in .env.local or in your hosting provider's settings (see .env.example).` +
        (publicOnes ? " NEXT_PUBLIC_ values are inlined at build time, so redeploy after adding them." : ""),
    );
    this.name = "MissingEnvError";
  }
}

/** Returns the values with their types narrowed to `string`, or throws one error naming every missing key. */
export function requireEnv<K extends string>(values: Record<K, string | undefined>): Record<K, string> {
  const missing = (Object.keys(values) as K[]).filter((key) => !values[key]?.trim());
  if (missing.length > 0) throw new MissingEnvError(missing);
  return values as Record<K, string>;
}

/** Supabase URL and anon key. Safe in the browser: RLS is what protects the data. */
export function publicEnv() {
  return requireEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** A server-only secret. Callers live behind `import "server-only"`, so these never reach the browser. */
export function serverEnv(name: ServerEnvVar): string {
  return requireEnv({ [name]: process.env[name] } as Record<ServerEnvVar, string | undefined>)[name];
}
