import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

/** Logout is a POST Server Action, never a GET link. */
export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={logoutAction}>
      <Button type="submit" variant="ghost" className={cn("h-9", className)}>
        <LogOutIcon aria-hidden="true" data-icon="inline-start" />
        Log out
      </Button>
    </form>
  );
}
