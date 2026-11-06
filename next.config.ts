import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { PUBLIC_ENV_VARS, SERVER_ENV_VARS, requireEnv } from "./src/lib/env";

export default function config(phase: string): NextConfig {
  // Fail the deploy in the first second with a list of what's missing, instead of a cryptic
  // prerender crash or a build that "succeeds" with `undefined` inlined into the browser bundle.
  // `next typegen` loads this file in the build phase too; the typecheck script opts out of the check.
  if (phase === PHASE_PRODUCTION_BUILD && process.env.SKIP_ENV_VALIDATION !== "1") {
    requireEnv(Object.fromEntries([...PUBLIC_ENV_VARS, ...SERVER_ENV_VARS].map((name) => [name, process.env[name]])));
  }
  return {};
}
