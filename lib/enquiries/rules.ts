import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ENQUIRY_STATUSES,
  SERVICES,
  type Enquiry,
  type EnquiryInput,
  type EnquiryStatus,
  type NotificationStatus,
} from "@/lib/enquiries/types";

/** Absolute follow-up delay. Matches `interval '72 hours'` in the SQL trigger. */
export const FOLLOW_UP_AFTER_MS = 72 * 60 * 60 * 1000;

/** Rolling window for the same email, service, and message. Compared as UTC instants. */
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const enquirySchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120),
  email: z
    .string()
    .trim()
    .max(320)
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.")),
  service: z
    .string()
    .trim()
    .transform((value) => {
      const match = SERVICES.find((service) => service.toLowerCase() === value.toLowerCase());
      return match ?? value;
    })
    .pipe(z.enum(SERVICES, { error: "Choose a service." })),
  message: z
    .string()
    .trim()
    .min(1, "Enter a message.")
    .max(5000, "Message must be 5000 characters or fewer."),
});

export type EnquiryField = "name" | "email" | "service" | "message";

export function fieldErrors(
  error: z.ZodError,
): Partial<Record<EnquiryField, string[]>> {
  const errors: Partial<Record<EnquiryField, string[]>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (key !== "name" && key !== "email" && key !== "service" && key !== "message") {
      continue;
    }
    errors[key] ??= [];
    errors[key].push(issue.message);
  }
  return errors;
}

export function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

export function enquiryFingerprint(input: EnquiryInput): string {
  const material = [
    input.email.trim().toLowerCase(),
    input.service.trim().toLowerCase(),
    normalizeMessage(input.message).toLowerCase(),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

/** UTC calendar day for an instant. `2026-10-18T00:30:00+02:00` is still 2026-10-17. */
export function utcCalendarDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp");
  }
  return date.toISOString().slice(0, 10);
}

export function isWithinDuplicateWindow(
  existingCreatedAt: string,
  incomingAt: Date,
  windowMs = DUPLICATE_WINDOW_MS,
): boolean {
  const existing = new Date(existingCreatedAt).getTime();
  if (Number.isNaN(existing)) return false;
  const incoming = incomingAt.getTime();
  return incoming >= existing && incoming - existing < windowMs;
}

/** Adds a fixed duration. Does not use local calendar days, so DST cannot shift it. */
export function followUpDueAt(quotedAt: Date, afterMs = FOLLOW_UP_AFTER_MS): Date {
  return new Date(quotedAt.getTime() + afterMs);
}

export function isEnquiryStatus(value: string): value is EnquiryStatus {
  return (ENQUIRY_STATUSES as readonly string[]).includes(value);
}

export function applyStatusTransition(
  enquiry: Enquiry,
  status: EnquiryStatus,
  now: Date,
): Enquiry {
  const updatedAt = now.toISOString();
  if (status === enquiry.status) {
    return { ...enquiry, updated_at: updatedAt };
  }

  if (status === "quoted") {
    return {
      ...enquiry,
      status,
      updated_at: updatedAt,
      quoted_at: updatedAt,
      follow_up_due_at: followUpDueAt(now).toISOString(),
      follow_up_sent_at: null,
      follow_up_cancelled_at: null,
    };
  }

  const leavingQuote = enquiry.status === "quoted";
  const closing = status === "won" || status === "lost";
  if ((leavingQuote || closing) && enquiry.follow_up_cancelled_at === null) {
    return {
      ...enquiry,
      status,
      updated_at: updatedAt,
      follow_up_cancelled_at: updatedAt,
    };
  }

  return { ...enquiry, status, updated_at: updatedAt };
}

export function isFollowUpEligible(enquiry: Enquiry, now: Date): boolean {
  if (enquiry.status !== "quoted") return false;
  if (!enquiry.follow_up_due_at) return false;
  if (enquiry.follow_up_cancelled_at) return false;
  if (enquiry.follow_up_sent_at) return false;
  const due = new Date(enquiry.follow_up_due_at).getTime();
  if (Number.isNaN(due)) return false;
  return due <= now.getTime();
}

export type NotificationDelivery =
  | { ok: true }
  | { ok: false; error: string; attempted: boolean };

export function applyNotificationResult(
  enquiry: Enquiry,
  delivery: NotificationDelivery,
): Pick<
  Enquiry,
  "notification_status" | "notification_error" | "notification_attempts"
> {
  if (delivery.ok) {
    return {
      notification_status: "sent",
      notification_error: null,
      notification_attempts: enquiry.notification_attempts + 1,
    };
  }

  const status: NotificationStatus = delivery.attempted ? "failed" : "pending";
  return {
    notification_status: status,
    notification_error: delivery.error.slice(0, 500),
    notification_attempts: delivery.attempted
      ? enquiry.notification_attempts + 1
      : enquiry.notification_attempts,
  };
}

export function normalizeTimeZone(timeZone: string | undefined): string {
  const candidate = timeZone?.trim() || "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "UTC";
  }
}

export function formatInstant(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timeZone),
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}
