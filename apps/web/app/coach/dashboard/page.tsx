import ConsoleDashboardPage from './console-page';

export default function CoachDashboardPage() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown';
  const shortSha = sha === 'unknown' ? sha : sha.slice(0, 7);

  return (
    <>
      <ConsoleDashboardPage />
      <div className="hidden md:block px-6 pb-6 text-xs text-[var(--muted)]">Build: {shortSha}</div>
    </>
  );
}
