import type { SupabaseClient } from "@supabase/supabase-js";
import { canReviewEnquiries } from "@/lib/enquiries/authz";
import { createClient } from "@/lib/supabase/server";

export type OwnerContext =
  | { signedIn: false; supabase: SupabaseClient }
  | { signedIn: true; isOwner: false; userId: string; supabase: SupabaseClient }
  | { signedIn: true; isOwner: true; userId: string; supabase: SupabaseClient };

export async function getOwnerContext(): Promise<OwnerContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = !error && data?.claims?.sub ? data.claims.sub : null;
  if (!userId) return { signedIn: false, supabase };

  const { data: owner, error: ownerError } = await supabase
    .from("owners")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (ownerError) throw new Error(ownerError.message);

  const isOwner = canReviewEnquiries({
    userId,
    ownerIds: owner ? [owner.user_id] : [],
  });

  return isOwner
    ? { signedIn: true, isOwner: true, userId, supabase }
    : { signedIn: true, isOwner: false, userId, supabase };
}
