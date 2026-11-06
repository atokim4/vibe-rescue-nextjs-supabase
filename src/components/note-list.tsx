"use client";

import { useState, useTransition } from "react";
import { deleteNote } from "@/app/dashboard/actions";

export type Note = { id: string; title: string; body: string; created_at: string };

export function NoteList({ notes }: { notes: Note[] }) {
  if (notes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
        No notes yet. Add your first one above.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} />
      ))}
    </ul>
  );
}

function NoteItem({ note }: { note: Note }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!window.confirm(`Delete "${note.title}"?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteNote(note.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <li className={`rounded-lg border border-stone-200 bg-white p-4 ${pending ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-medium break-words">{note.title}</h2>
          {note.body && <p className="mt-1 text-sm break-words whitespace-pre-wrap text-stone-700">{note.body}</p>}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label={`Delete note: ${note.title}`}
          className="shrink-0 text-sm text-red-700 hover:underline disabled:cursor-wait"
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}
