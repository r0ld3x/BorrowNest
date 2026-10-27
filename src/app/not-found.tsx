import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mt-2 text-muted-foreground">
        The page you are looking for does not exist or has moved.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/listings" className={buttonVariants({ size: "lg" })}>
          Browse listings
        </Link>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Go to home page
        </Link>
      </div>
    </section>
  );
}
