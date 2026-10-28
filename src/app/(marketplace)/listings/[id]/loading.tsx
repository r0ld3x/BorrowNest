export default function ListingDetailLoading() {
  return (
    <div role="status" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12">
      <span className="sr-only">Loading listing</span>
      <div aria-hidden="true" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3">
          <div className="aspect-4/3 animate-pulse rounded-xl bg-muted" />
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="aspect-4/3 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </div>
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}
