import Link from "next/link";

export default function Home() {
  return (
    <section className="space-y-6 py-10">
      <h1 className="text-4xl font-bold tracking-tight">Notes that stay yours.</h1>
      <p className="max-w-xl text-stone-600">
        Jotpad keeps short private notes. The free plan holds 3 notes; Pro (Stripe test mode) removes the limit.
      </p>
      <Link
        href="/login"
        className="inline-block rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
      >
        Get started
      </Link>
    </section>
  );
}
