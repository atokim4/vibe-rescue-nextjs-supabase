import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // A relative Location keeps the browser on the host it used. `request.url` can carry the server's own
  // hostname (localhost behind a proxy), which would land the user on another origin without their cookies.
  return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
}
