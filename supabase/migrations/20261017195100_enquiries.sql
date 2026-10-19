-- Enquiry desk.
-- Run this in the Supabase SQL editor. It is safe to run once on a new project.
--
-- After it succeeds:
-- 1. Create the owner in Authentication → Users.
-- 2. Insert that user into public.owners (see the bottom of this file).
--
-- Timestamps are timestamptz, so they store an absolute instant and display
-- correctly in any time zone. Follow-up due times are 72 hours after a quote,
-- measured in absolute time, not local calendar days.

create type public.enquiry_status as enum (
  'new',
  'contacted',
  'quoted',
  'won',
  'lost'
);

create type public.notification_status as enum (
  'pending',
  'sent',
  'failed'
);

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  service text not null,
  message text not null,
  status public.enquiry_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  quoted_at timestamptz,
  follow_up_due_at timestamptz,
  follow_up_sent_at timestamptz,
  follow_up_cancelled_at timestamptz,
  notification_status public.notification_status not null default 'pending',
  notification_error text,
  notification_attempts integer not null default 0,
  fingerprint text not null,
  created_on_utc date not null,
  constraint enquiries_name_len check (char_length(name) between 2 and 120),
  constraint enquiries_email_len check (char_length(email) between 3 and 320),
  constraint enquiries_service_len check (char_length(service) between 2 and 120),
  constraint enquiries_message_len check (char_length(message) between 1 and 5000),
  constraint enquiries_attempts_nonneg check (notification_attempts >= 0),
  constraint enquiries_fingerprint_len check (char_length(fingerprint) = 64),
  constraint enquiries_fingerprint_utc_day unique (fingerprint, created_on_utc)
);

comment on table public.enquiries is
  'Customer enquiries. created_at is when the enquiry arrived.';

comment on column public.enquiries.created_on_utc is
  'UTC calendar day of created_at, set by the app. Combined with fingerprint to stop same-day duplicate races.';

create index enquiries_created_at_idx
  on public.enquiries (created_at desc);

create index enquiries_fingerprint_created_idx
  on public.enquiries (fingerprint, created_at desc);

create index enquiries_follow_up_due_idx
  on public.enquiries (follow_up_due_at)
  where status = 'quoted'
    and follow_up_cancelled_at is null
    and follow_up_sent_at is null;

create table public.owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.owners is
  'Accounts allowed to review enquiries. Membership is not taken from editable profile data.';

-- Status changes own the follow-up clock so a direct Data API update cannot
-- leave an accepted quote on the follow-up list.
create or replace function public.enforce_enquiry_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();

  if tg_op = 'UPDATE' then
    if new.status = 'quoted' and old.status is distinct from 'quoted' then
      new.quoted_at := now();
      new.follow_up_due_at := now() + interval '72 hours';
      new.follow_up_sent_at := null;
      new.follow_up_cancelled_at := null;
    elsif old.status = 'quoted' and new.status is distinct from 'quoted' then
      if new.follow_up_cancelled_at is null then
        new.follow_up_cancelled_at := now();
      end if;
    elsif new.status in ('won', 'lost')
      and old.status is distinct from new.status
      and new.follow_up_cancelled_at is null then
      new.follow_up_cancelled_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger enquiries_enforce_transition
  before insert or update on public.enquiries
  for each row
  execute function public.enforce_enquiry_transition();

revoke all on function public.enforce_enquiry_transition() from public;
revoke all on function public.enforce_enquiry_transition() from anon;
revoke all on function public.enforce_enquiry_transition() from authenticated;

alter table public.enquiries enable row level security;
alter table public.owners enable row level security;

revoke all on table public.enquiries from public, anon, authenticated;
revoke all on table public.owners from public, anon, authenticated;

-- Authenticated owners can read rows. They cannot insert or delete.
-- The public form writes with the server secret key, which bypasses RLS.
grant select on table public.enquiries to authenticated;
grant update (
  status,
  updated_at,
  quoted_at,
  follow_up_due_at,
  follow_up_sent_at,
  follow_up_cancelled_at,
  notification_status,
  notification_error,
  notification_attempts
) on table public.enquiries to authenticated;

grant select on table public.owners to authenticated;

grant select, insert, update, delete on table public.enquiries to service_role;
grant select, insert, update, delete on table public.owners to service_role;

create policy "Owners can read enquiries"
  on public.enquiries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.owners
      where owners.user_id = (select auth.uid())
    )
  );

create policy "Owners can update enquiries"
  on public.enquiries
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.owners
      where owners.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.owners
      where owners.user_id = (select auth.uid())
    )
  );

create policy "Owners can read their membership"
  on public.owners
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Replace the email, then run this once the owner has signed up:
--
-- insert into public.owners (user_id)
-- select id from auth.users where email = 'owner@example.com';
