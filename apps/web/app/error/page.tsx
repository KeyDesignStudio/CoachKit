export default function ErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-page)]">
      <div className="w-full max-w-md rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center shadow-xl">
        <h1 className="mb-4 text-3xl font-semibold text-[var(--text)]">
          Authentication Error
        </h1>
        <p className="mb-6 text-[var(--muted)]">
          Something went wrong during sign-in. Please try again.
        </p>
        <a
          href="/sign-in"
          className="inline-block rounded-full bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
        >
          Return to Sign In
        </a>
      </div>
    </div>
  );
}
