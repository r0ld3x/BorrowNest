export default function ListingsLoading() {
  return (
    <div role="status" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
      <span className="sr-only">Loading listings</span>
      <div aria-hidden="true">
        <div className="h-9 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
        <div className="mt-3 h-5 w-96 max-w-full animate-pulse rounded bg-muted" />
        <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="hidden h-96 animate-pulse rounded-xl bg-muted lg:block" />
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="aspect-4/3 animate-pulse bg-muted" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-8 w-full animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
