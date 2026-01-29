import Link from 'next/link';

export function AiPlanBuilderPage({ athleteId }: { athleteId: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">AI Plan Builder (v1)</h1>
          <p className="text-sm text-[var(--fg-muted)]">
            Tranche 1 scaffold: feature-flagged, deterministic, no plan mutations.
          </p>
        </div>
        <Link
          className="text-sm underline"
          href={{ pathname: '/coach/athletes/[athleteId]', query: { athleteId } }}
        >
          Back to athlete
        </Link>
      </div>

      <div className="mt-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium">Status:</span> Enabled via <code>AI_PLAN_BUILDER_V1</code>
          </div>
          <div>
            <span className="font-medium">Safety:</span> This page is isolated and currently read-only.
          </div>
        </div>
      </div>
    </div>
  );
}
