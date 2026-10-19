import type { SupabaseClient } from "@supabase/supabase-js";
import { isFollowUpEligible, utcCalendarDay } from "@/lib/enquiries/rules";
import {
  DuplicateEnquiryError,
  type EnquiryStore,
} from "@/lib/enquiries/store";
import type { Enquiry } from "@/lib/enquiries/types";
import { createServiceClient } from "@/lib/supabase/service";

function asEnquiry(row: Enquiry): Enquiry {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    service: row.service,
    message: row.message,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    quoted_at: row.quoted_at,
    follow_up_due_at: row.follow_up_due_at,
    follow_up_sent_at: row.follow_up_sent_at,
    follow_up_cancelled_at: row.follow_up_cancelled_at,
    notification_status: row.notification_status,
    notification_error: row.notification_error,
    notification_attempts: row.notification_attempts,
    fingerprint: row.fingerprint,
  };
}

export function createSupabaseStore(client: SupabaseClient): EnquiryStore {
  return {
    async findRecentByFingerprint(fingerprint, sinceIso) {
      const { data, error } = await client
        .from("enquiries")
        .select("*")
        .eq("fingerprint", fingerprint)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? asEnquiry(data as Enquiry) : null;
    },

    async insert(enquiry) {
      const { data, error } = await client
        .from("enquiries")
        .insert({ ...enquiry, created_on_utc: utcCalendarDay(enquiry.created_at) })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") throw new DuplicateEnquiryError();
        throw new Error(error.message);
      }
      return asEnquiry(data as Enquiry);
    },

    async update(id, patch) {
      const { data, error } = await client
        .from("enquiries")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return asEnquiry(data as Enquiry);
    },

    async get(id) {
      const { data, error } = await client
        .from("enquiries")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? asEnquiry(data as Enquiry) : null;
    },

    async list() {
      const { data, error } = await client
        .from("enquiries")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => asEnquiry(row as Enquiry));
    },

    async claimFollowUp(id, nowIso) {
      const current = await this.get(id);
      if (!current || !isFollowUpEligible(current, new Date(nowIso))) return null;

      const { data, error } = await client
        .from("enquiries")
        .update({ follow_up_sent_at: nowIso })
        .eq("id", id)
        .eq("status", "quoted")
        .is("follow_up_cancelled_at", null)
        .is("follow_up_sent_at", null)
        .lte("follow_up_due_at", nowIso)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? asEnquiry(data as Enquiry) : null;
    },
  };
}

export function createServiceStore(): EnquiryStore {
  return createSupabaseStore(createServiceClient());
}
