import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

/** Pages that need a signed-in user. Everything else is public. */
const PROTECTED_PREFIXES = ["/dashboard"];
/** Pages a signed-in user has no reason to see. */
const AUTH_PAGES = ["/login"];

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Refreshes the Supabase session cookie on every matched request and does optimistic
 * route protection. Real authorization happens in Postgres through RLS.
 */
export async function proxy(request: NextRequest) {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = publicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A redirect is a new response: copy the refreshed session cookies onto it,
  // otherwise the browser keeps the stale token and the next request fails again.
  const redirectTo = (url: URL) => {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  const { pathname, search } = request.nextUrl;

  if (!user && isProtected(pathname)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    return redirectTo(login);
  }

  if (user && AUTH_PAGES.includes(pathname)) {
    return redirectTo(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  // Skip static assets and the Stripe webhook: Stripe has no session cookie and must reach the handler.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook).*)"],
};
