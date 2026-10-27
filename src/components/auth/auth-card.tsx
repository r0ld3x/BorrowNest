import { SettingsIcon } from "lucide-react";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? (
        <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
}

/** Shown on account routes when Supabase environment values are missing. */
export function SetupNotice() {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-border bg-muted p-4 text-sm">
      <SettingsIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">Accounts are not set up yet</p>
        <p className="text-muted-foreground">
          This deployment is missing its Supabase configuration, so signing up
          and logging in are unavailable. Browsing sample listings still works.
        </p>
      </div>
    </div>
  );
}
