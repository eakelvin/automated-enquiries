"use client";

import { useActionState } from "react";
import {
  retryNotification,
  updateEnquiryStatus,
  type StatusState,
} from "@/app/actions/enquiries";
import { ENQUIRY_STATUSES, STATUS_LABELS, type EnquiryStatus } from "@/lib/enquiries/types";

const initialState: StatusState = {};

export function EnquiryControls({
  id,
  status,
  notificationStatus,
}: {
  id: string;
  status: EnquiryStatus;
  notificationStatus: "pending" | "sent" | "failed";
}) {
  const [statusState, statusAction, statusPending] = useActionState(
    updateEnquiryStatus,
    initialState,
  );
  const [retryState, retryAction, retryPending] = useActionState(
    retryNotification,
    initialState,
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={statusAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input type="hidden" name="id" value={id} />
        <label htmlFor={`status-${id}`} className="sr-only">
          Status
        </label>
        <select
          id={`status-${id}`}
          name="status"
          defaultValue={status}
          className="h-10 rounded-md border border-line bg-paper px-2 text-sm"
        >
          {ENQUIRY_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={statusPending}
          className="h-10 rounded-md border border-line px-3 text-sm font-medium hover:bg-background disabled:opacity-60"
        >
          {statusPending ? "Saving…" : "Update status"}
        </button>
      </form>
      {statusState.message ? (
        <p role="status" className="text-sm text-muted">
          {statusState.message}
        </p>
      ) : null}
      {notificationStatus !== "sent" ? (
        <form action={retryAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={retryPending}
            className="text-sm font-medium text-pine underline-offset-2 hover:underline disabled:opacity-60"
          >
            {retryPending ? "Retrying…" : "Retry notification"}
          </button>
          {retryState.message ? (
            <p role="status" className="mt-1 text-sm text-muted">
              {retryState.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
