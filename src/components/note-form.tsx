"use client";

import { useState, useTransition } from "react";
import { addNote } from "@/app/dashboard/actions";
import { BODY_MAX, TITLE_MAX } from "@/lib/notes";

export function NoteForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await addNote(data);
      // Only clear the form once the note is saved, so a failure never loses what the user typed.
      if (result.ok) form.reset();
      else setError(result.error);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="space-y-2 rounded-lg border border-stone-200 bg-white p-4"
    >
      <label className="sr-only" htmlFor="note-title">
        Title
      </label>
      <input
        id="note-title"
        name="title"
        required
        maxLength={TITLE_MAX}
        placeholder="Title"
        className="w-full rounded-md border border-stone-300 px-3 py-2"
      />
      <label className="sr-only" htmlFor="note-body">
        Note
      </label>
      <textarea
        id="note-body"
        name="body"
        maxLength={BODY_MAX}
        placeholder="Write something…"
        className="h-24 w-full rounded-md border border-stone-300 px-3 py-2"
      />
      <div className="flex items-center gap-3">
        <button
          disabled={pending}
          className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Saving…" : "Add note"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
