import { bearerToken, secretsMatch } from "@/lib/security";
import { listDueFollowUps, claimFollowUp } from "@/lib/enquiries/service";
import type { EnquiryStore } from "@/lib/enquiries/store";
import type { Enquiry } from "@/lib/enquiries/types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authorizeMake(
  request: Request,
  secret: string | undefined,
): Response | null {
  if (!secret) {
    return Response.json(
      { error: "Follow-up checks are not configured." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!secretsMatch(bearerToken(request), secret)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  return null;
}

function followUpBody(enquiry: Enquiry) {
  return {
    id: enquiry.id,
    name: enquiry.name,
    email: enquiry.email,
    service: enquiry.service,
    message: enquiry.message,
    status: enquiry.status,
    quoted_at: enquiry.quoted_at,
    follow_up_due_at: enquiry.follow_up_due_at,
    created_at: enquiry.created_at,
  };
}

export async function listFollowUpsResponse(
  store: EnquiryStore,
  now: Date,
): Promise<Response> {
  const followUps = await listDueFollowUps(store, now);
  return Response.json(
    {
      now: now.toISOString(),
      time_zone: "UTC",
      follow_ups: followUps.map(followUpBody),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function claimFollowUpsResponse(
  request: Request,
  store: EnquiryStore,
  now: Date,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON body." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const ids = (body as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) {
    return Response.json(
      { error: "ids must be an array of 1 to 50 enquiry ids." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return Response.json(
      { error: "Every id must be a UUID." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const claimed: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const row = await claimFollowUp(store, id, now);
    if (row) claimed.push(row.id);
    else skipped.push(id);
  }

  return Response.json(
    { claimed, skipped },
    { headers: { "cache-control": "no-store" } },
  );
}
