import { authorizeMake, listFollowUpsResponse } from "@/lib/enquiries/follow-ups";
import { createServiceStore } from "@/lib/enquiries/supabase-store";

export async function GET(request: Request) {
  const denied = authorizeMake(request, process.env.MAKE_API_SECRET);
  if (denied) return denied;

  try {
    return await listFollowUpsResponse(createServiceStore(), new Date());
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: "Enquiry storage is not configured." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
