"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/env";
import { getOwnerContext } from "@/lib/auth";
import { deliverNotification } from "@/lib/enquiries/notify";
import {
  applyNotificationResult,
  isEnquiryStatus,
} from "@/lib/enquiries/rules";
import { changeEnquiryStatus, submitEnquiry } from "@/lib/enquiries/service";
import { createSupabaseStore, createServiceStore } from "@/lib/enquiries/supabase-store";
import type { EnquiryField } from "@/lib/enquiries/rules";

export type EnquiryFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  duplicate?: boolean;
  errors?: Partial<Record<EnquiryField, string[]>>;
};

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createEnquiry(
  _state: EnquiryFormState,
  formData: FormData,
): Promise<EnquiryFormState> {
  try {
    const result = await submitEnquiry(
      {
        name: formText(formData, "name"),
        email: formText(formData, "email"),
        service: formText(formData, "service"),
        message: formText(formData, "message"),
      },
      {
        store: () => createServiceStore(),
        webhookUrl: process.env.MAKE_WEBHOOK_URL,
        webhookSecret: process.env.MAKE_WEBHOOK_SECRET,
        appUrl: appUrl(),
      },
    );

    if (!result.ok) {
      return { status: "error", message: result.message, errors: result.errors };
    }

    return {
      status: "success",
      duplicate: result.duplicate,
      message: result.duplicate
        ? "We already have this enquiry and will be in touch."
        : "Your enquiry is in. We will reply by email.",
    };
  } catch (error) {
    console.error(error);
    const missingConfig =
      error instanceof Error && error.message.startsWith("Missing ");
    return {
      status: "error",
      message: missingConfig
        ? "Supabase is not connected yet. Add the project URL and secret key, then try again."
        : "We couldn't save your enquiry. Please try again.",
    };
  }
}

export type StatusState = { message?: string };

async function requireOwnerStore() {
  const context = await getOwnerContext();
  if (!context.signedIn) redirect("/login");
  if (!context.isOwner) {
    return { ok: false as const, message: "This account cannot review enquiries." };
  }
  return { ok: true as const, store: createSupabaseStore(context.supabase) };
}

export async function updateEnquiryStatus(
  _state: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const id = formData.get("id");
  const status = formData.get("status");
  if (typeof id !== "string" || typeof status !== "string" || !isEnquiryStatus(status)) {
    return { message: "Choose a valid status." };
  }

  const access = await requireOwnerStore();
  if (!access.ok) return { message: access.message };

  try {
    await changeEnquiryStatus(access.store, id, status, new Date());
  } catch (error) {
    console.error(error);
    return { message: "The status could not be updated." };
  }

  revalidatePath("/dashboard");
  return { message: "Status saved." };
}

export async function retryNotification(
  _state: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const id = formData.get("id");
  if (typeof id !== "string") return { message: "Missing enquiry." };

  const access = await requireOwnerStore();
  if (!access.ok) return { message: access.message };

  try {
    const enquiry = await access.store.get(id);
    if (!enquiry) return { message: "Enquiry not found." };
    if (enquiry.notification_status === "sent") {
      return { message: "The notification was already sent." };
    }

    const delivery = await deliverNotification(enquiry, {
      webhookUrl: process.env.MAKE_WEBHOOK_URL,
      webhookSecret: process.env.MAKE_WEBHOOK_SECRET,
      appUrl: appUrl(),
    });
    await access.store.update(id, applyNotificationResult(enquiry, delivery));
    revalidatePath("/dashboard");
    return {
      message: delivery.ok
        ? "Notification sent."
        : `Notification not sent. ${delivery.error}`,
    };
  } catch (error) {
    console.error(error);
    return { message: "The notification could not be retried." };
  }
}
