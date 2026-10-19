import type { Enquiry } from "@/lib/enquiries/types";
import type { NotificationDelivery } from "@/lib/enquiries/rules";

export type NotificationPayload = {
  event: "enquiry.created";
  id: string;
  subject: string;
  name: string;
  email: string;
  service: string;
  message: string;
  status: Enquiry["status"];
  created_at: string;
  dashboard_url: string;
};

export function notificationPayload(
  enquiry: Enquiry,
  appUrl: string,
): NotificationPayload {
  return {
    event: "enquiry.created",
    id: enquiry.id,
    subject: enquiry.service,
    name: enquiry.name,
    email: enquiry.email,
    service: enquiry.service,
    message: enquiry.message,
    status: enquiry.status,
    created_at: enquiry.created_at,
    dashboard_url: `${appUrl}/dashboard`,
  };
}

export async function deliverNotification(
  enquiry: Enquiry,
  options: {
    webhookUrl: string | undefined;
    webhookSecret?: string;
    appUrl: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<NotificationDelivery> {
  const webhookUrl = options.webhookUrl?.trim();
  if (!webhookUrl) {
    return {
      ok: false,
      attempted: false,
      error: "MAKE_WEBHOOK_URL is not configured",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.webhookSecret) {
    headers["x-make-secret"] = options.webhookSecret;
  }

  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(notificationPayload(enquiry, options.appUrl)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
    if (!response.ok) {
      return {
        ok: false,
        attempted: true,
        error: `Make webhook returned ${response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Make webhook failed";
    return { ok: false, attempted: true, error: message };
  }
}
