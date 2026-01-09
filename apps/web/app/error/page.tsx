export default function ErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-white/20 bg-white/40 p-8 text-center backdrop-blur-3xl shadow-xl">
        <h1 className="mb-4 text-3xl font-bold text-slate-900">
          Authentication Error
        </h1>
        <p className="mb-6 text-slate-600">
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
