import Link from "next/link";
import { io } from "next/cache";
import { Suspense, type ReactNode } from "react";
import { signOut } from "@/app/actions/auth";
import { EnquiryControls } from "@/app/dashboard/enquiry-controls";
import { getOwnerContext } from "@/lib/auth";
import { publicSupabaseConfig, ownerTimeZone } from "@/lib/env";
import { formatInstant } from "@/lib/enquiries/rules";
import { createSupabaseStore } from "@/lib/enquiries/supabase-store";
import {
  ENQUIRY_STATUSES,
  STATUS_LABELS,
  type Enquiry,
  type EnquiryStatus,
} from "@/lib/enquiries/types";

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Enquiries</h1>
          <p className="mt-1 text-sm text-muted">
            Times are shown in {ownerTimeZone()}. Stored instants are UTC.
          </p>
        </div>
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Loading enquiries…</p>}>
        <EnquiryList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function EnquiryList({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  if (!publicSupabaseConfig()) {
    return (
      <p className="rounded-lg border border-line bg-paper px-4 py-3 text-sm">
        Add the Supabase URL and publishable key to <code>.env.local</code>, then
        restart the server.
      </p>
    );
  }

  // getClaims reads Date.now() for token expiry. This stays outside the
  // try/catch so the prerender abort is handled by React, not logged as a failure.
  await io();

  let context: Awaited<ReturnType<typeof getOwnerContext>>;
  try {
    context = await getOwnerContext();
  } catch (error) {
    console.error(error);
    return (
      <p className="rounded-lg border border-danger/30 bg-paper px-4 py-3 text-sm text-danger">
        The owner check failed. Confirm the migration ran and the owners table is
        readable by authenticated users.
      </p>
    );
  }

  if (!context.signedIn) {
    return (
      <p className="text-sm">
        <Link href="/login" className="font-medium text-pine">
          Sign in
        </Link>{" "}
        to review enquiries.
      </p>
    );
  }

  if (!context.isOwner) {
    return (
      <div className="rounded-lg border border-line bg-paper px-4 py-4 text-sm">
        <p>This account is not on the owners list.</p>
        <form action={signOut} className="mt-3">
          <button type="submit" className="font-medium text-pine">
            Sign out
          </button>
        </form>
      </div>
    );
  }

  const params = await searchParams;
  const requested = typeof params.status === "string" ? params.status : "all";
  const filter = (ENQUIRY_STATUSES as readonly string[]).includes(requested)
    ? (requested as EnquiryStatus)
    : null;

  let enquiries: Enquiry[];
  try {
    enquiries = await createSupabaseStore(context.supabase).list();
  } catch (error) {
    console.error(error);
    return (
      <p className="rounded-lg border border-danger/30 bg-paper px-4 py-3 text-sm text-danger">
        Enquiries could not be loaded. Check that the table grants and row
        security policies from the migration are in place.
      </p>
    );
  }

  const visible = filter
    ? enquiries.filter((enquiry) => enquiry.status === filter)
    : enquiries;
  const zone = ownerTimeZone();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <FilterLink href="/dashboard" active={!filter}>
            All
          </FilterLink>
          {ENQUIRY_STATUSES.map((status) => (
            <FilterLink
              key={status}
              href={`/dashboard?status=${status}`}
              active={filter === status}
            >
              {STATUS_LABELS[status]}
            </FilterLink>
          ))}
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm font-medium text-pine">
            Sign out
          </button>
        </form>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No enquiries in this view.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {visible.map((enquiry) => (
            <li
              key={enquiry.id}
              className="rounded-xl border border-line bg-paper p-4 sm:p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{enquiry.name}</h2>
                    <StatusPill status={enquiry.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    <a className="underline-offset-2 hover:underline" href={`mailto:${enquiry.email}`}>
                      {enquiry.email}
                    </a>
                    {" · "}
                    {enquiry.service}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                    {enquiry.message}
                  </p>
                  <dl className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-foreground">Arrived</dt>
                      <dd>{formatInstant(enquiry.created_at, zone)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Notification</dt>
                      <dd>
                        {enquiry.notification_status}
                        {enquiry.notification_error
                          ? ` — ${enquiry.notification_error}`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-foreground">Follow-up</dt>
                      <dd>{followUpLabel(enquiry, zone)}</dd>
                    </div>
                  </dl>
                </div>
                <EnquiryControls
                  id={enquiry.id}
                  status={enquiry.status}
                  notificationStatus={enquiry.notification_status}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function followUpLabel(enquiry: Enquiry, zone: string): string {
  if (enquiry.follow_up_cancelled_at) {
    return `Cancelled ${formatInstant(enquiry.follow_up_cancelled_at, zone)}`;
  }
  if (enquiry.follow_up_sent_at) {
    return `Sent ${formatInstant(enquiry.follow_up_sent_at, zone)}`;
  }
  if (enquiry.follow_up_due_at) {
    return `Due ${formatInstant(enquiry.follow_up_due_at, zone)}`;
  }
  return "Not scheduled";
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-foreground px-3 py-1 text-sm text-background"
          : "rounded-full border border-line px-3 py-1 text-sm text-muted"
      }
    >
      {children}
    </Link>
  );
}

function StatusPill({ status }: { status: EnquiryStatus }) {
  const tone =
    status === "won"
      ? "bg-pine/10 text-pine-dark"
      : status === "lost"
        ? "bg-danger/10 text-danger"
        : status === "quoted"
          ? "bg-amber-100 text-amber-950"
          : "bg-background text-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
