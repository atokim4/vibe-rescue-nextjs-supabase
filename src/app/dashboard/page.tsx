import { redirect } from "next/navigation";
import { NoteForm } from "@/components/note-form";
import { NoteList } from "@/components/note-list";
import { UpgradeButton } from "@/components/upgrade-button";
import { UpgradePending } from "@/components/upgrade-pending";
import { FREE_NOTE_LIMIT } from "@/lib/notes";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  const [notesResult, profileResult] = await Promise.all([
    // RLS already limits rows to the owner; the explicit filter keeps the query honest and uses the index.
    supabase
      .from("notes")
      .select("id, title, body, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("plan").eq("id", user.id).single(),
  ]);

  // The broken version ignored these errors and rendered "No notes yet." Throwing shows error.tsx instead.
  if (notesResult.error) throw new Error(`Loading notes failed: ${notesResult.error.message}`);
  if (profileResult.error) throw new Error(`Loading the profile failed: ${profileResult.error.message}`);

  const notes = notesResult.data;
  const isPro = profileResult.data.plan === "pro";
  const limitReached = !isPro && notes.length >= FREE_NOTE_LIMIT;
  const justPaid = (await searchParams).upgraded === "1";

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Your notes</h1>
          <p className="text-sm break-all text-stone-600">
            {user.email} · {isPro ? "Pro plan" : `Free plan (${notes.length}/${FREE_NOTE_LIMIT} notes)`}
          </p>
        </div>
        <div className="flex items-start gap-3">
          {!isPro && !justPaid && <UpgradeButton />}
          <form action="/auth/signout" method="post">
            <button className="py-1.5 text-sm text-stone-600 hover:underline">Sign out</button>
          </form>
        </div>
      </div>

      {justPaid &&
        (isPro ? (
          <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
            You&apos;re on Pro now. Thanks for testing the checkout.
          </p>
        ) : (
          <UpgradePending />
        ))}

      {limitReached ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          The free plan holds {FREE_NOTE_LIMIT} notes. Delete one or upgrade to Pro to add more.
        </p>
      ) : (
        <NoteForm />
      )}
      <NoteList notes={notes} />
    </section>
  );
}
