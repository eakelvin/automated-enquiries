import { LoginForm } from "@/app/login/login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Owner sign in</h1>
      <p className="mt-2 text-sm leading-6 text-muted">
        Only an account listed in the owners table can review enquiries.
      </p>
      <div className="mt-8 rounded-xl border border-line bg-paper p-5 sm:p-7">
        <LoginForm />
      </div>
    </main>
  );
}
