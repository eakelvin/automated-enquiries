import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseConfig, supabaseSecretKey } from "@/lib/env";

export function createServiceClient() {
  const config = publicSupabaseConfig();
  const secret = supabaseSecretKey();
  if (!config || !secret) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY",
    );
  }

  return createSupabaseClient(config.url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
