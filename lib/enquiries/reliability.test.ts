import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canReviewEnquiries } from "@/lib/enquiries/authz";
import {
  authorizeMake,
  claimFollowUpsResponse,
  listFollowUpsResponse,
} from "@/lib/enquiries/follow-ups";
import { deliverNotification } from "@/lib/enquiries/notify";
import {
  DUPLICATE_WINDOW_MS,
  FOLLOW_UP_AFTER_MS,
  applyStatusTransition,
  enquiryFingerprint,
  enquirySchema,
  followUpDueAt,
  formatInstant,
  isFollowUpEligible,
  isWithinDuplicateWindow,
  normalizeTimeZone,
  utcCalendarDay,
} from "@/lib/enquiries/rules";
import {
  changeEnquiryStatus,
  listDueFollowUps,
  submitEnquiry,
} from "@/lib/enquiries/service";
import {
  DuplicateEnquiryError,
  type EnquiryStore,
} from "@/lib/enquiries/store";
import type { Enquiry } from "@/lib/enquiries/types";
import { secretsMatch } from "@/lib/security";

const input = {
  name: "Ada Lovelace",
  email: "Ada@Example.com",
  service: "Design",
  message: "Need a new site",
};

class MemoryStore implements EnquiryStore {
  rows: Enquiry[] = [];

  async findRecentByFingerprint(fingerprint: string, sinceIso: string) {
    return (
      this.rows
        .filter((row) => row.fingerprint === fingerprint && row.created_at >= sinceIso)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null
    );
  }

  async insert(enquiry: Enquiry) {
    const day = enquiry.created_at.slice(0, 10);
    const clash = this.rows.some(
      (row) =>
        row.fingerprint === enquiry.fingerprint && row.created_at.slice(0, 10) === day,
    );
    if (clash) throw new DuplicateEnquiryError();
    this.rows.push(enquiry);
    return enquiry;
  }

  async update(id: string, patch: Partial<Enquiry>) {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error("Enquiry not found");
    this.rows[index] = { ...this.rows[index], ...patch };
    return this.rows[index];
  }

  async get(id: string) {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async list() {
    return [...this.rows];
  }

  async claimFollowUp(id: string, nowIso: string) {
    const row = this.rows.find((item) => item.id === id);
    if (!row || !isFollowUpEligible(row, new Date(nowIso))) return null;
    row.follow_up_sent_at = nowIso;
    row.updated_at = nowIso;
    return { ...row };
  }
}

function notifyOk() {
  return vi.fn(async () => ({ ok: true as const }));
}

describe("duplicates", () => {
  it("keeps one enquiry when the same request arrives again inside 24 hours", async () => {
    const store = new MemoryStore();
    const notify = notifyOk();
    const now = new Date("2026-10-17T10:00:00.000Z");
    const first = await submitEnquiry(input, { store, now, notify, webhookUrl: "https://make.example" });
    const second = await submitEnquiry(
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        service: "design",
        message: "  Need   a new site  ",
      },
      {
        store,
        now: new Date("2026-10-17T18:00:00.000Z"),
        notify,
        webhookUrl: "https://make.example",
      },
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.enquiry.id).toBe(first.enquiry.id);
    expect(store.rows).toHaveLength(1);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("treats the window as UTC instants, including across a local midnight", async () => {
    const store = new MemoryStore();
    const notify = notifyOk();
    const arrived = new Date("2026-10-17T22:30:00.000Z");
    await submitEnquiry(input, { store, now: arrived, notify, webhookUrl: "https://make.example" });

    const stillDuplicate = await submitEnquiry(input, {
      store,
      now: new Date("2026-10-18T21:30:00.000Z"),
      notify,
      webhookUrl: "https://make.example",
    });
    const fresh = await submitEnquiry(input, {
      store,
      now: new Date(arrived.getTime() + DUPLICATE_WINDOW_MS),
      notify,
      webhookUrl: "https://make.example",
    });

    expect(stillDuplicate.ok && stillDuplicate.duplicate).toBe(true);
    expect(fresh.ok && fresh.duplicate).toBe(false);
    expect(store.rows).toHaveLength(2);
    expect(isWithinDuplicateWindow(arrived.toISOString(), new Date(arrived.getTime() + DUPLICATE_WINDOW_MS - 1))).toBe(true);
    expect(isWithinDuplicateWindow(arrived.toISOString(), new Date(arrived.getTime() + DUPLICATE_WINDOW_MS))).toBe(false);
  });

  it("returns the saved row when a same-day insert races", async () => {
    const store = new MemoryStore();
    const notify = notifyOk();
    const original = store.insert.bind(store);
    store.insert = async (enquiry) => {
      store.rows.push({ ...enquiry });
      throw new DuplicateEnquiryError();
    };

    const result = await submitEnquiry(input, {
      store,
      now: new Date("2026-10-17T10:00:00.000Z"),
      notify,
      webhookUrl: "https://make.example",
    });

    expect(result.ok && result.duplicate).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    store.insert = original;
  });
});

describe("failed emails", () => {
  it("saves the enquiry when Make rejects the notification", async () => {
    const store = new MemoryStore();
    const notify = vi.fn(async () => ({
      ok: false as const,
      attempted: true,
      error: "SMTP 550 mailbox unavailable",
    }));

    const result = await submitEnquiry(input, {
      store,
      now: new Date("2026-10-17T10:00:00.000Z"),
      notify,
      webhookUrl: "https://make.example/hook",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enquiry.notification_status).toBe("failed");
    expect(result.enquiry.notification_error).toBe("SMTP 550 mailbox unavailable");
    expect(result.enquiry.notification_attempts).toBe(1);
    expect(store.rows).toHaveLength(1);
  });

  it("records a thrown webhook error without dropping the enquiry", async () => {
    const store = new MemoryStore();
    const notify = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await submitEnquiry(input, {
      store,
      now: new Date("2026-10-17T10:00:00.000Z"),
      notify,
      webhookUrl: "https://make.example/hook",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enquiry.notification_status).toBe("failed");
    expect(result.enquiry.notification_error).toBe("network down");
  });

  it("leaves the notification pending when the webhook URL is missing", async () => {
    const delivery = await deliverNotification(
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Ada",
        email: "ada@example.com",
        service: "Design",
        message: "Hello",
        status: "new",
        created_at: "2026-10-17T10:00:00.000Z",
      } as Enquiry,
      { webhookUrl: "  ", appUrl: "http://localhost:3000" },
    );
    expect(delivery).toEqual({
      ok: false,
      attempted: false,
      error: "MAKE_WEBHOOK_URL is not configured",
    });
  });

  it("marks an HTTP failure from the webhook response", async () => {
    const delivery = await deliverNotification(
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Ada",
        email: "ada@example.com",
        service: "Design",
        message: "Hello",
        status: "new",
        created_at: "2026-10-17T10:00:00.000Z",
      } as Enquiry,
      {
        webhookUrl: "https://make.example/hook",
        appUrl: "http://localhost:3000",
        fetchImpl: vi.fn(async () => new Response("no", { status: 502 })),
      },
    );
    expect(delivery).toEqual({
      ok: false,
      attempted: true,
      error: "Make webhook returned 502",
    });
  });
});

describe("permissions", () => {
  it("allows only listed owner ids", () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    expect(canReviewEnquiries({ userId: null, ownerIds: [ownerId] })).toBe(false);
    expect(canReviewEnquiries({ userId: "someone-else", ownerIds: [ownerId] })).toBe(false);
    expect(canReviewEnquiries({ userId: ownerId, ownerIds: [ownerId] })).toBe(true);
  });

  it("rejects follow-up calls that do not present the Make secret", () => {
    const secret = "correct-horse";
    expect(authorizeMake(new Request("https://app.example/api/follow-ups"), secret)?.status).toBe(401);
    expect(
      authorizeMake(
        new Request("https://app.example/api/follow-ups", {
          headers: { authorization: "Bearer wrong" },
        }),
        secret,
      )?.status,
    ).toBe(401);
    expect(
      authorizeMake(
        new Request("https://app.example/api/follow-ups", {
          headers: { authorization: "Bearer correct-horse" },
        }),
        secret,
      ),
    ).toBeNull();
    expect(authorizeMake(new Request("https://app.example/api/follow-ups"), undefined)?.status).toBe(503);
    expect(secretsMatch("correct-horse", "correct-horse")).toBe(true);
    expect(secretsMatch("nope", "correct-horse")).toBe(false);
  });

  it("locks the database grants to owners and the server role", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261017195100_enquiries.sql"),
      "utf8",
    );
    expect(sql).toContain("enable row level security");
    expect(sql.match(/enable row level security/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\bto\s+anon\b/i);
    expect(sql).not.toContain("user_metadata");
    expect(sql).not.toContain("auth.role()");
    expect(sql).toContain("grant select on table public.enquiries to authenticated");
    expect(sql).toContain("grant select, insert, update, delete on table public.enquiries to service_role");
    expect(sql).toContain('for update');
    expect(sql).toContain("with check");
    expect(sql).toContain("to authenticated");
    expect(sql).not.toContain("security definer");
  });
});

describe("time zones", () => {
  it("stores one instant and formats it in the owner zone", () => {
    const iso = "2026-10-17T21:30:00.000Z";
    expect(formatInstant(iso, "UTC")).toMatch(/21:30/);
    expect(formatInstant(iso, "Europe/Amsterdam")).toMatch(/23:30/);
    expect(formatInstant(iso, "America/Los_Angeles")).toMatch(/14:30/);
    expect(normalizeTimeZone("Not/AZone")).toBe("UTC");
    expect(formatInstant(iso, "Not/AZone")).toMatch(/21:30/);
  });

  it("schedules follow-up 72 absolute hours later, across the DST change", () => {
    const quotedAt = new Date("2026-10-24T22:30:00.000Z");
    const due = followUpDueAt(quotedAt);
    expect(FOLLOW_UP_AFTER_MS).toBe(72 * 60 * 60 * 1000);
    expect(due.toISOString()).toBe("2026-10-27T22:30:00.000Z");
    expect(formatInstant(due.toISOString(), "Europe/Amsterdam")).toMatch(/27 Oct 2026/);
    expect(formatInstant(due.toISOString(), "Europe/Amsterdam")).toMatch(/23:30/);
    expect(formatInstant(due.toISOString(), "Europe/Amsterdam")).not.toMatch(/00:30/);
  });

  it("defines the duplicate day and follow-up interval in UTC inside SQL", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261017195100_enquiries.sql"),
      "utf8",
    );
    expect(sql).toContain("timestamptz not null default now()");
    expect(sql).toContain("created_on_utc date not null");
    expect(sql).toContain("unique (fingerprint, created_on_utc)");
    expect(sql).toContain("interval '72 hours'");
    expect(utcCalendarDay("2026-10-18T00:30:00+02:00")).toBe("2026-10-17");
    expect(utcCalendarDay("2026-10-17T22:30:00.000Z")).toBe("2026-10-17");
  });
});

describe("follow-up cancellation when a quote is accepted", () => {
  it("drops an accepted quote from the due list and refuses to claim it", async () => {
    const store = new MemoryStore();
    const notify = notifyOk();
    const created = await submitEnquiry(input, {
      store,
      now: new Date("2026-10-17T10:00:00.000Z"),
      notify,
      webhookUrl: "https://make.example",
    });
    if (!created.ok) throw new Error("expected save");

    const quotedAt = new Date("2026-10-17T12:00:00.000Z");
    const quoted = await changeEnquiryStatus(store, created.enquiry.id, "quoted", quotedAt);
    const dueAt = new Date(quotedAt.getTime() + FOLLOW_UP_AFTER_MS);
    expect(isFollowUpEligible(quoted, dueAt)).toBe(true);
    expect(await listDueFollowUps(store, dueAt)).toHaveLength(1);

    const acceptedAt = new Date(dueAt.getTime() + 60_000);
    const won = await changeEnquiryStatus(store, quoted.id, "won", acceptedAt);
    expect(won.status).toBe("won");
    expect(won.follow_up_cancelled_at).toBe(acceptedAt.toISOString());
    expect(isFollowUpEligible(won, acceptedAt)).toBe(false);
    expect(await listDueFollowUps(store, acceptedAt)).toHaveLength(0);

    const response = await claimFollowUpsResponse(
      new Request("https://app.example/api/follow-ups/claim", {
        method: "POST",
        body: JSON.stringify({ ids: [won.id] }),
      }),
      store,
      acceptedAt,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ claimed: [], skipped: [won.id] });

    const listed = await listFollowUpsResponse(store, acceptedAt);
    const body = (await listed.json()) as { follow_ups: { id: string }[] };
    expect(body.follow_ups).toEqual([]);
  });

  it("cancels follow-up in SQL when the status becomes won", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261017195100_enquiries.sql"),
      "utf8",
    );
    expect(sql).toMatch(/new\.status in \('won', 'lost'\)/);
    expect(sql).toContain("new.follow_up_cancelled_at := now()");
    expect(sql).toContain("old.status = 'quoted' and new.status is distinct from 'quoted'");
  });

  it("reopens a follow-up only when the enquiry is quoted again", () => {
    const base = enquirySchema.parse(input);
    const fingerprint = enquiryFingerprint(base);
    const created = "2026-10-17T10:00:00.000Z";
    let enquiry: Enquiry = {
      id: "11111111-1111-4111-8111-111111111111",
      name: base.name,
      email: base.email,
      service: base.service,
      message: base.message,
      status: "new",
      created_at: created,
      updated_at: created,
      quoted_at: null,
      follow_up_due_at: null,
      follow_up_sent_at: null,
      follow_up_cancelled_at: null,
      notification_status: "sent",
      notification_error: null,
      notification_attempts: 1,
      fingerprint,
    };
    enquiry = applyStatusTransition(enquiry, "quoted", new Date("2026-10-17T12:00:00.000Z"));
    enquiry = applyStatusTransition(enquiry, "won", new Date("2026-10-18T12:00:00.000Z"));
    expect(enquiry.follow_up_cancelled_at).not.toBeNull();
    enquiry = applyStatusTransition(enquiry, "quoted", new Date("2026-10-19T12:00:00.000Z"));
    expect(enquiry.follow_up_cancelled_at).toBeNull();
    expect(enquiry.follow_up_due_at).toBe("2026-10-22T12:00:00.000Z");
  });
});
