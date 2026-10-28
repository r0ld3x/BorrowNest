-- BorrowNest Stage 10: admin action logs are append-only for everyone,
-- including the database owner (clients were already denied by grants).
create trigger admin_audit_logs_immutable before update or delete on public.admin_audit_logs
  for each row execute function private.forbid_change();
