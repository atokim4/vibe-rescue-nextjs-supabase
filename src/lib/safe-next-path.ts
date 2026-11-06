/**
 * Returns `next` only when it is a path on this site, so `/login?next=` can't be used
 * to bounce a freshly signed-in user to another domain (open redirect).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
