import { randomUUID } from "node:crypto";
import { deliverNotification } from "@/lib/enquiries/notify";
import {
  applyNotificationResult,
  applyStatusTransition,
  DUPLICATE_WINDOW_MS,
  enquiryFingerprint,
  enquirySchema,
  fieldErrors,
  isFollowUpEligible,
  isWithinDuplicateWindow,
  type EnquiryField,
} from "@/lib/enquiries/rules";
import { DuplicateEnquiryError, type EnquiryStore } from "@/lib/enquiries/store";
import type { Enquiry, EnquiryStatus } from "@/lib/enquiries/types";

export type SubmitResult =
  | {
      ok: true;
      duplicate: boolean;
      enquiry: Enquiry;
    }
  | {
      ok: false;
      message: string;
      errors?: Partial<Record<EnquiryField, string[]>>;
    };

export type NotifyEnquiry = typeof deliverNotification;

function blankEnquiry(input: {
  id: string;
  name: string;
  email: string;
  service: string;
  message: string;
  fingerprint: string;
  createdAt: string;
}): Enquiry {
  return {
    id: input.id,
    name: input.name,
    email: input.email,
    service: input.service,
    message: input.message,
    status: "new",
    created_at: input.createdAt,
    updated_at: input.createdAt,
    quoted_at: null,
    follow_up_due_at: null,
    follow_up_sent_at: null,
    follow_up_cancelled_at: null,
    notification_status: "pending",
    notification_error: null,
    notification_attempts: 0,
    fingerprint: input.fingerprint,
  };
}

export async function submitEnquiry(
  raw: unknown,
  deps: {
    store: EnquiryStore | (() => EnquiryStore | Promise<EnquiryStore>);
    now?: Date;
    notify?: NotifyEnquiry;
    webhookUrl?: string;
    webhookSecret?: string;
    appUrl?: string;
  },
): Promise<SubmitResult> {
  const parsed = enquirySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form and try again.",
      errors: fieldErrors(parsed.error),
    };
  }

  const store = typeof deps.store === "function" ? await deps.store() : deps.store;
  const now = deps.now ?? new Date();
  const fingerprint = enquiryFingerprint(parsed.data);
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString();
  const existing = await store.findRecentByFingerprint(fingerprint, since);
  if (existing && isWithinDuplicateWindow(existing.created_at, now)) {
    return { ok: true, duplicate: true, enquiry: existing };
  }

  const enquiry = blankEnquiry({
    id: randomUUID(),
    name: parsed.data.name,
    email: parsed.data.email,
    service: parsed.data.service,
    message: parsed.data.message,
    fingerprint,
    createdAt: now.toISOString(),
  });

  let saved: Enquiry;
  try {
    saved = await store.insert(enquiry);
  } catch (error) {
    if (error instanceof DuplicateEnquiryError) {
      const again = await store.findRecentByFingerprint(fingerprint, since);
      if (again && isWithinDuplicateWindow(again.created_at, now)) {
        return { ok: true, duplicate: true, enquiry: again };
      }
      return {
        ok: false,
        message: "This enquiry was just submitted. Please wait a moment and try again.",
      };
    }
    throw error;
  }

  const notify = deps.notify ?? deliverNotification;
  let delivery;
  try {
    delivery = await notify(saved, {
      webhookUrl: deps.webhookUrl,
      webhookSecret: deps.webhookSecret,
      appUrl: deps.appUrl ?? "http://localhost:3000",
    });
  } catch (error) {
    delivery = {
      ok: false as const,
      attempted: true,
      error: error instanceof Error ? error.message : "Make webhook failed",
    };
  }
  const recorded = await store.update(saved.id, applyNotificationResult(saved, delivery));
  return { ok: true, duplicate: false, enquiry: recorded };
}

export async function changeEnquiryStatus(
  store: EnquiryStore,
  id: string,
  status: EnquiryStatus,
  now: Date,
): Promise<Enquiry> {
  const current = await store.get(id);
  if (!current) {
    throw new Error("Enquiry not found");
  }
  const next = applyStatusTransition(current, status, now);
  return store.update(id, {
    status: next.status,
    updated_at: next.updated_at,
    quoted_at: next.quoted_at,
    follow_up_due_at: next.follow_up_due_at,
    follow_up_sent_at: next.follow_up_sent_at,
    follow_up_cancelled_at: next.follow_up_cancelled_at,
  });
}

export async function listDueFollowUps(
  store: EnquiryStore,
  now: Date,
): Promise<Enquiry[]> {
  const rows = await store.list();
  return rows.filter((enquiry) => isFollowUpEligible(enquiry, now));
}

export async function claimFollowUp(
  store: EnquiryStore,
  id: string,
  now: Date,
): Promise<Enquiry | null> {
  return store.claimFollowUp(id, now.toISOString());
}
