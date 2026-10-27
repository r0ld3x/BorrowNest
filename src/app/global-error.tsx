"use client"; // Error boundaries must be Client Components

import "./globals.css";

// Replaces the root layout when it fails, so it renders its own html/body.
// The thrown value is never displayed.
export default function GlobalError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="en-IN">
      <body className="flex min-h-screen items-center justify-center bg-background px-4 font-sans text-foreground">
        <section className="max-w-md text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
          <p className="mt-2 text-muted-foreground">
            BorrowNest could not load. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Try again
          </button>
        </section>
      </body>
    </html>
  );
}
