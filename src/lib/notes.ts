export const FREE_NOTE_LIMIT = 3;
export const TITLE_MAX = 120;
export const BODY_MAX = 5000;

export type NoteInput = { title: string; body: string };
export type ActionResult = { ok: true } | { ok: false; error: string };

/** Validates the add-note form on the server. The browser's `required` attribute is only a convenience. */
export function parseNoteInput(form: FormData): { ok: true; value: NoteInput } | { ok: false; error: string } {
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();

  if (!title) return { ok: false, error: "Give the note a title." };
  if (title.length > TITLE_MAX) return { ok: false, error: `Keep the title under ${TITLE_MAX} characters.` };
  if (body.length > BODY_MAX) return { ok: false, error: `Keep the note under ${BODY_MAX} characters.` };
  return { ok: true, value: { title, body } };
}

/** Turns a PostgREST error from an insert into something a user can act on. */
export function insertErrorMessage(error: { code?: string }): string {
  // 42501 = insufficient_privilege: the insert policy rejected the row, which for a signed-in user
  // writing their own note means the free plan limit (see can_add_note()).
  if (error.code === "42501") return `The free plan holds ${FREE_NOTE_LIMIT} notes. Upgrade to Pro to add more.`;
  return "Couldn't save the note. Check your connection and try again.";
}
