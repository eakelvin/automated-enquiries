export const ENQUIRY_STATUSES = [
  "new",
  "contacted",
  "quoted",
  "won",
  "lost",
] as const;

export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const NOTIFICATION_STATUSES = ["pending", "sent", "failed"] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const SERVICES = [
  "Consulting",
  "Design",
  "Development",
  "Support",
  "Other",
] as const;

export type Service = (typeof SERVICES)[number];

export type Enquiry = {
  id: string;
  name: string;
  email: string;
  service: string;
  message: string;
  status: EnquiryStatus;
  created_at: string;
  updated_at: string;
  quoted_at: string | null;
  follow_up_due_at: string | null;
  follow_up_sent_at: string | null;
  follow_up_cancelled_at: string | null;
  notification_status: NotificationStatus;
  notification_error: string | null;
  notification_attempts: number;
  fingerprint: string;
};

export type EnquiryInput = {
  name: string;
  email: string;
  service: string;
  message: string;
};

export const STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};
