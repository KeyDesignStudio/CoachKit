'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { PlanLibraryIngestForm } from '@/components/admin/PlanLibraryIngestForm';
import { PlanLibrarySourceCatalog } from '@/components/admin/PlanLibrarySourceCatalog';
import { WorkoutExemplarCatalog } from '@/components/admin/WorkoutExemplarCatalog';

type AdminPlanLibraryWorkspaceProps = {
  adminEmail: string;
};

export function AdminPlanLibraryWorkspace({ adminEmail }: AdminPlanLibraryWorkspaceProps) {
  const [refreshNonce, setRefreshNonce] = useState(0);

  const handleIngested = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Plan Library (PlanSource v1)</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Upload sources here, then use Parser Studio to review extraction quality before weighting them up in APB.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={'/admin/plan-library/parser-studio' as any}
            className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--border-subtle)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-structure)]"
          >
            Open Parser Studio
          </Link>
          <div className="text-sm text-muted-foreground">Admin: {adminEmail}</div>
        </div>
      </div>

      <div className="space-y-6">
        <PlanLibraryIngestForm onIngested={handleIngested} />
        <PlanLibrarySourceCatalog refreshNonce={refreshNonce} />
        <WorkoutExemplarCatalog />
      </div>
    </div>
  );
}
