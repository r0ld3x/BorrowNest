# BorrowNest

> Rent essentials, not expenses.

[Live demo](https://borrownest.vercel.app/)

## Demo accounts

| Role | Name | Email | Password |
| --- | --- | --- | --- |
| Provider | Neha Verma | neha@roldex.me | `R0ld3x0p@1` |
| Renter | Arjun Singh | arjun@roldex.me | `R0ld3x0p@1` |
| Admin | BorrowNest Admin | admin@roldex.me | `R0ld3x0p@1` |

BorrowNest is a hyperlocal rental marketplace for Gwalior, India. It helps students, interns, and temporary residents rent the furniture, appliances, bicycles, study essentials, kitchen equipment, and household items they need for a short stay—without the cost and waste of buying them outright.

Built for a hackathon, BorrowNest follows a rental from a provider's first listing through moderation, booking, mutual handover, return, deposit settlement, and dispute resolution.

## The problem

Moving to a new city for a semester, internship, or short job means needing everyday essentials immediately. Buying them is expensive, selling them later is inconvenient, and informal rental arrangements offer little clarity around condition, deposits, dates, or returns.

BorrowNest makes those exchanges structured and local:

- Providers turn underused essentials into income.
- Renters find practical items close to where they are staying.
- Both sides work from the same recorded rental terms.
- Exact pickup details stay private until a booking is confirmed.

## What BorrowNest does

### Marketplace discovery

- Browse approved Gwalior listings by category, area, daily rent, and keyword.
- Compare daily rental cost and refundable deposit before making a request.
- View an accessible image gallery, listing condition, public area, landmark, and item details.
- Use responsive desktop and mobile filters, loading states, no-results guidance, and dark mode.

### Provider tools

- Create and manage one physical item per listing.
- Add up to five ordered JPEG, PNG, or WebP photos, including a cover image.
- Store exact pickup instructions separately from public listing information.
- Save drafts, submit listings for review, pause them, or archive them.
- See incoming rental requests and atomically accept or reject them.

### Renter booking flow

- Request future rentals with start and end dates in Gwalior time (`Asia/Kolkata`).
- See an instant estimate with inclusive rental days, rent, refundable deposit, and total due.
- Keep a permanent booking snapshot: later listing price or address changes do not rewrite agreed terms.
- View confirmed pickup instructions only after the provider accepts the request.

### Trust and resolution workflow

- Admin review queue for approving or rejecting listings.
- Account suspension and restoration controls with append-only audit records.
- Versioned mutual handover: the rental starts only when both participants confirm the same handover summary.
- Versioned return and settlement: completion requires both parties to confirm the same return terms.
- Private issue reporting, evidence, and an explicit administrative resolution path when agreement breaks down.

## How a rental moves through BorrowNest

```text
Provider creates a draft
  → submits it for review
  → admin approves and publishes it
  → renter requests future dates
  → provider confirms the request
  → both parties confirm handover
  → rental becomes active
  → return time and settlement are agreed
  → both parties confirm return
  → booking is completed
```

The booking status stays intentionally simple:

```text
pending → confirmed | rejected | cancelled
confirmed → completed
```

The physical rental exchange is tracked independently:

```text
awaiting_handover → active → return_requested → returned
```

This separation prevents an active rental from being silently erased and makes mutual agreement distinct from an administrative decision.

## Product rules

| Area | BorrowNest rule |
| --- | --- |
| Service area | Gwalior only |
| Listing unit | One physical item per listing; no quantity inventory |
| Categories | Furniture, Appliances, Bicycles, Study Essentials, Kitchen, Other |
| Item condition | New, Like New, Good, Fair |
| Booking dates | Start date must be tomorrow or later; both start and end dates are billable |
| Price | `rental_days × price_per_day_snapshot` |
| Total due | `rental_amount + deposit_snapshot` |
| Payments | Recorded as offline participant acknowledgements; BorrowNest does not process or independently verify transfers |
| Delivery | Pickup only for the MVP |

## Privacy and integrity by design

BorrowNest is designed around a few non-negotiable boundaries:

- Public pages show a listing's area and landmark—not its exact pickup address, contact details, or moderation notes.
- Exact pickup details are shared only with eligible participants after confirmation and are retained only where an active or disputed exchange requires them.
- Roles are renter, provider, and admin. Accounts cannot self-promote to admin.
- Every sensitive action checks the current authenticated identity, role, ownership, and account status at the database boundary.
- Rental prices, deposits, participants, and state transitions are calculated in PostgreSQL rather than trusted from browser input.
- Confirmation is versioned. Changing handover or return terms invalidates prior confirmations.
- Confirmed and completed date ranges cannot overlap for the same item.
- Listing and dispute evidence use scoped access; private information is excluded from public queries, URLs, page data, and logs.

## Architecture

| Layer | Technology / approach |
| --- | --- |
| Web application | Next.js 16 App Router with strict TypeScript and React 19 |
| Interface | Tailwind CSS, shadcn/ui, Base UI, and next-themes |
| Identity and data | Supabase Auth, PostgreSQL, Storage, and official SSR clients |
| Validation | Zod at server input boundaries |
| Mutations | Server Actions backed by narrowly scoped PostgreSQL functions |
| Authorization | Supabase Row Level Security, column grants, role checks, and ownership checks |
| Concurrency | Transactional functions, row locks, immutable snapshots, and database constraints |
| Image handling | Server-side image inspection with bounded type, size, dimension, and count checks |

The project deliberately avoids a separate application backend, custom JWT issuance, and custom password hashing.

## Run locally

### Prerequisites

- Node.js 20+
- npm
- A Supabase project

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure environment variables

Create `.env.local` with your own Supabase project values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
IMAGE_ATTESTATION_SECRET=replace-with-a-random-server-only-secret
```

`IMAGE_ATTESTATION_SECRET` must remain server-only. Never prefix it with `NEXT_PUBLIC_`.

### 3. Apply database migrations

Apply the SQL files in `supabase/migrations/` to a fresh Supabase PostgreSQL database in filename order. For an existing database, take a backup first and apply migrations through a reviewed Supabase migration workflow.

After creating a confirmed account, promote the intended administrator using the scoped operator SQL in `supabase/operator/promote-admin.sql`.

### 4. Configure Supabase

- Enable email confirmation and password recovery for your project.
- Add `http://localhost:3000/auth/confirm` to the allowed redirect URLs for local development.
- Create the product-photo Storage bucket and apply the migration-defined storage policies.
- For deployed environments, set an HTTPS `NEXT_PUBLIC_SITE_URL` and add only the exact production callback URL.

### 5. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Database boundary and lifecycle test scripts live under `supabase/tests/`. Run them only against a disposable Supabase project using synthetic accounts and fixtures.

## Hackathon demo path

Use a study table rental to show the full value of the product in a few minutes:

1. Sign in as Neha, create a listing with photos, a public area/landmark, and private pickup details.
2. Submit the draft; sign in as the administrator to approve it.
3. Browse the published listing as Arjun, select future dates, and show the transparent quote.
4. Submit the request; return to the provider account and confirm it.
5. Show that confirmed participants can see the pickup snapshot while public visitors cannot.
6. Record matching handover confirmations to activate the rental.
7. Propose and accept a return time, agree the deposit outcome, then record both return confirmations.
8. Open a sample issue to show the dispute hold and clear distinction between participant agreement and an administrator's audited resolution.

## Scope and current limitations

- BorrowNest currently serves Gwalior only.
- Each listing represents one physical item.
- Pickup is the only fulfillment mode in the MVP.
- Payments and deposit refunds happen offline; acknowledgement is not bank or payment-gateway verification.
- Moderation, account support, and dispute closure are manual administrative workflows.
- Extensions, automated late fees, delivery, ratings, and independent enforcement of a dispute outcome are outside the MVP.
- The repository includes security-focused migrations and test scenarios, but a production deployment and a completed live security test matrix should not be implied until they are run against the target Supabase environment.

## License and photo credits

Demo-listing photo attributions are available in [docs/demo-photo-credits.md](docs/demo-photo-credits.md).
