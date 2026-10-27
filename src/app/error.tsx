"use client"; // Error boundaries must be Client Components

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";

// The thrown value is intentionally never rendered: it may contain internal
// details. Production Server Component errors already arrive redacted.
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-2 text-muted-foreground">
        This page could not be displayed. Please try again in a moment.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Go to home page
        </Link>
      </div>
    </section>
  );
}
