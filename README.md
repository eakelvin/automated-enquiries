# Enquiry desk

A Next.js desk for incoming work. Visitors send an enquiry. Supabase stores it with a status and the time it arrived. Make sends the internal notification and checks for quotes that need a follow-up. The owner reviews everything on a protected dashboard.

## What is stored

Each enquiry has a name, email, service, message, status (`new`, `contacted`, `quoted`, `won`, or `lost`), and `created_at`. All timestamps are `timestamptz` instants. The dashboard formats them in `OWNER_TIME_ZONE`.

## 1. Supabase

Create a project, then open the SQL editor and run [`supabase/migrations/20261017195100_enquiries.sql`](supabase/migrations/20261017195100_enquiries.sql).

The migration:

- creates `enquiries` and `owners`
- enables row level security
- grants no access to `anon`
- lets authenticated owners read and update enquiries
- lets the server secret key insert public enquiries
- cancels a pending follow-up when a quote is marked won or lost

In Authentication → Users, create the owner (email and password). Then run:

```sql
insert into public.owners (user_id)
select id from auth.users where email = 'owner@example.com';
```

Copy `.env.example` to `.env.local` and fill in the project URL, the publishable key, and the secret key. The secret key stays on the server.

## 2. Make

Two scenarios. Blueprint files in `make/` are a starting point: after import, connect your email account and replace the placeholder URL and secret.

**Internal notification**

1. Create a scenario with a custom webhook, then an email module.
2. Copy the webhook URL into `MAKE_WEBHOOK_URL`.
3. Optional: set the same value as `MAKE_WEBHOOK_SECRET` in Make (header `x-make-secret`) and in `.env.local`.

The app posts this JSON after the row is saved:

```json
{
  "event": "enquiry.created",
  "id": "uuid",
  "subject": "Design",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "service": "Design",
  "message": "Need a new site",
  "status": "new",
  "created_at": "2026-10-17T19:51:00.000Z",
  "dashboard_url": "http://localhost:3000/dashboard"
}
```

If Make is down, the enquiry stays saved and `notification_status` becomes `failed`. Retry it from the dashboard. If the webhook URL is not set yet, the status stays `pending`.

**Quote follow-up**

1. Set `MAKE_API_SECRET` to a long random string.
2. Schedule a scenario (daily is enough).
3. `GET {APP_URL}/api/follow-ups` with `Authorization: Bearer <MAKE_API_SECRET>`.
4. For each id, `POST {APP_URL}/api/follow-ups/claim` with `{ "ids": ["<id>"] }` and the same header.
5. Email only ids in the `claimed` array.

A quote becomes due 72 hours after it is marked quoted. Marking it won or lost sets `follow_up_cancelled_at`, and the claim call skips it. That is what stops a follow-up after the quote is accepted, even if Make already listed it.

## 3. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the form and [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to sign in.

## Reliability

`npm test` covers:

- duplicate enquiries inside 24 hours, including a request that crosses local midnight, and a same-day insert race
- a failed or thrown Make webhook, which keeps the enquiry and records the failure
- owner membership, the Make bearer secret, and the SQL grants (no anon access, no `user_metadata`)
- UTC storage, owner-zone display, and a 72-hour follow-up that does not shift across daylight saving time
- follow-up cancellation when a quote is marked won, including a claim that arrives after acceptance
