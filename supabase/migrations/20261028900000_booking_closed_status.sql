-- BorrowNest Stage 10: an administrative closure is a distinct outcome from
-- mutual completion. Added on its own because a new enum value cannot be
-- used in the same transaction that creates it.
alter type public.booking_status add value if not exists 'closed';
