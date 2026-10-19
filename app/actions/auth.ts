"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export type LoginState = {
  message?: string;
  errors?: { email?: string[]; password?: string[] };
};

export async function signIn(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const errors: LoginState["errors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key !== "email" && key !== "password") continue;
      errors[key] ??= [];
      errors[key].push(issue.message);
    }
    return { errors, message: "Check the form and try again." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { message: "Those credentials were not accepted." };
  } catch (error) {
    console.error(error);
    return { message: "Sign-in is not configured yet. Add the Supabase keys and try again." };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
