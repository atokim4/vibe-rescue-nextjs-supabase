import Link from "next/link";

export default function NotFound() {
  return (
    <section className="space-y-4 py-10">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-stone-600">There&apos;s nothing at this address.</p>
      <Link href="/" className="text-emerald-800 underline">
        Back to Jotpad
      </Link>
    </section>
  );
}
