export default function DashboardLoading() {
  return (
    <section aria-busy="true" aria-label="Loading your notes" className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-stone-200" />
        <div className="h-4 w-56 rounded bg-stone-200" />
      </div>
      <div className="h-40 rounded-lg bg-stone-200" />
      {[0, 1].map((i) => (
        <div key={i} className="h-20 rounded-lg bg-stone-200" />
      ))}
    </section>
  );
}
