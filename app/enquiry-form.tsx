"use client";

import { useActionState, type ReactNode } from "react";
import { createEnquiry, type EnquiryFormState } from "@/app/actions/enquiries";
import { SERVICES } from "@/lib/enquiries/types";

const initialState: EnquiryFormState = { status: "idle" };

export function EnquiryForm() {
  const [state, formAction, pending] = useActionState(createEnquiry, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <Field
        id="name"
        label="Name"
        error={state.errors?.name?.[0]}
      >
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          aria-invalid={Boolean(state.errors?.name)}
          aria-describedby={state.errors?.name ? "name-error" : undefined}
          className={controlClass}
        />
      </Field>

      <Field id="email" label="Email" error={state.errors?.email?.[0]}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          aria-invalid={Boolean(state.errors?.email)}
          aria-describedby={state.errors?.email ? "email-error" : undefined}
          className={controlClass}
        />
      </Field>

      <Field
        id="service"
        label="Service requested"
        error={state.errors?.service?.[0]}
      >
        <select
          id="service"
          name="service"
          required
          defaultValue=""
          aria-invalid={Boolean(state.errors?.service)}
          aria-describedby={state.errors?.service ? "service-error" : undefined}
          className={controlClass}
        >
          <option value="" disabled>
            Select a service
          </option>
          {SERVICES.map((service) => (
            <option key={service} value={service}>
              {service}
            </option>
          ))}
        </select>
      </Field>

      <Field id="message" label="Message" error={state.errors?.message?.[0]}>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          maxLength={5000}
          aria-invalid={Boolean(state.errors?.message)}
          aria-describedby={state.errors?.message ? "message-error" : undefined}
          className={`${controlClass} resize-y`}
        />
      </Field>

      {state.message ? (
        <p
          role="status"
          className={
            state.status === "error"
              ? "rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
              : "rounded-md border border-pine/30 bg-pine/5 px-3 py-2 text-sm text-pine-dark"
          }
        >
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-md bg-pine px-4 text-sm font-medium text-white transition-colors hover:bg-pine-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send enquiry"}
      </button>
    </form>
  );
}

const controlClass =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-foreground";

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
