import { EnquiryForm } from "@/app/enquiry-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:flex-row lg:items-start lg:justify-between">
      <section className="max-w-md">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-pine">
          New enquiry
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance">
          Tell us what you need.
        </h1>
        <p className="mt-4 text-base leading-7 text-muted">
          Leave your name, email, the service you want, and a short message.
          Each enquiry is saved with the time it arrived. A duplicate sent
          within 24 hours is kept once.
        </p>
      </section>
      <section className="w-full max-w-xl rounded-xl border border-line bg-paper p-5 shadow-sm sm:p-7">
        <EnquiryForm />
      </section>
    </main>
  );
}
