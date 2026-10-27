export default function Loading() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-4 py-24"
    >
      <span
        aria-hidden="true"
        className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary"
      />
      <span className="sr-only">Loading</span>
    </div>
  );
}
