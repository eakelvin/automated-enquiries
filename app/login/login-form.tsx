"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={Boolean(state.errors?.email)}
          className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm"
        />
        {state.errors?.email?.[0] ? (
          <p className="text-sm text-danger">{state.errors.email[0]}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          aria-invalid={Boolean(state.errors?.password)}
          className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm"
        />
        {state.errors?.password?.[0] ? (
          <p className="text-sm text-danger">{state.errors.password[0]}</p>
        ) : null}
      </div>
      {state.message ? (
        <p role="status" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-md bg-pine px-4 text-sm font-medium text-white hover:bg-pine-dark disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
