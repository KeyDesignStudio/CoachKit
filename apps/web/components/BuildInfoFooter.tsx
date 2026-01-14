type BuildInfoFooterProps = {
  className?: string;
};

function shortSha(sha: string | undefined): string {
  if (!sha) return 'unknown';
  return sha.length <= 7 ? sha : sha.slice(0, 7);
}

export function BuildInfoFooter({ className }: BuildInfoFooterProps) {
  const vercelEnv = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV;
  const show = process.env.NEXT_PUBLIC_SHOW_BUILD_INFO === 'true' || vercelEnv !== 'production';
  if (!show) return null;

  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_SHA;
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME_UTC ?? process.env.BUILD_TIME_UTC;
  const envLabel = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV;

  const parts = [`SHA ${shortSha(sha)}`];
  if (buildTime) parts.push(buildTime);
  if (envLabel) parts.push(envLabel);

  return (
    <div
      className={
        className ??
        'px-4 md:px-6 pb-4 md:pb-6 text-[10px] md:text-xs text-[var(--muted)] select-none'
      }
      aria-label="Build information"
    >
      Build: {parts.join(' · ')}
    </div>
  );
}
