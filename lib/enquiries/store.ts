import type { Enquiry } from "@/lib/enquiries/types";

export interface EnquiryStore {
  findRecentByFingerprint(
    fingerprint: string,
    sinceIso: string,
  ): Promise<Enquiry | null>;
  insert(enquiry: Enquiry): Promise<Enquiry>;
  update(id: string, patch: Partial<Enquiry>): Promise<Enquiry>;
  get(id: string): Promise<Enquiry | null>;
  list(): Promise<Enquiry[]>;
  claimFollowUp(id: string, nowIso: string): Promise<Enquiry | null>;
}

export class DuplicateEnquiryError extends Error {
  readonly code = "23505";

  constructor() {
    super("Duplicate enquiry");
    this.name = "DuplicateEnquiryError";
  }
}
