import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/safe-next-path";
import { createClient } from "@/lib/supabase/server";

/** Relative on purpose: see the sign-out route. `path` always starts with a single "/". */
const redirectTo = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } });

/** Landing point of the email confirmation link: trade the one-time code for a session. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectTo(safeNextPath(searchParams.get("next")));
  }

  return redirectTo("/login?error=confirmation_failed");
}
