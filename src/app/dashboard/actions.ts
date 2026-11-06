"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, insertErrorMessage, parseNoteInput } from "@/lib/notes";
import { createClient } from "@/lib/supabase/server";

const SESSION_EXPIRED: ActionResult = { ok: false, error: "Your session has expired. Sign in again." };

export async function addNote(form: FormData): Promise<ActionResult> {
  const input = parseNoteInput(form);
  if (!input.ok) return input;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  const { error } = await supabase.from("notes").insert({ ...input.value, user_id: user.id });
  if (error) {
    if (error.code !== "42501") console.error("addNote failed", error.message);
    return { ok: false, error: insertErrorMessage(error) };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteNote(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;

  // RLS already limits deletes to the owner; .select() tells us whether a row was actually removed.
  const { data, error } = await supabase.from("notes").delete().eq("id", id).eq("user_id", user.id).select("id");
  if (error) {
    console.error("deleteNote failed", error.message);
    return { ok: false, error: "Couldn't delete the note. Try again." };
  }

  revalidatePath("/dashboard");
  return data.length > 0 ? { ok: true } : { ok: false, error: "That note no longer exists." };
}
