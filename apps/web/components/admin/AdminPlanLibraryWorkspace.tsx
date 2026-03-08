'use client';

import { useCallback, useState } from 'react';

import { PlanLibraryImportConsole } from '@/components/admin/PlanLibraryImportConsole';
import { PlanLibraryQualityInsights } from '@/components/admin/PlanLibraryQualityInsights';
import { PlanLibraryTemplateReviewGrid } from '@/components/admin/PlanLibraryTemplateReviewGrid';
import { WorkoutExemplarCatalog } from '@/components/admin/WorkoutExemplarCatalog';

type AdminPlanLibraryWorkspaceProps = {
  adminEmail?: string | null;
};

export function AdminPlanLibraryWorkspace({ adminEmail }: AdminPlanLibraryWorkspaceProps) {
  const [refreshNonce, setRefreshNonce] = useState(0);

  const handleIngested = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Plan Library</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Ingest source plans with automatic structured extraction, then approve only trusted sources CoachKit should use.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {adminEmail ? <div className="text-sm text-muted-foreground">Admin: {adminEmail}</div> : null}
        </div>
      </div>

      <div className="space-y-6">
        <PlanLibraryImportConsole onImported={() => handleIngested()} />
        <PlanLibraryQualityInsights refreshToken={refreshNonce} />
        <PlanLibraryTemplateReviewGrid refreshToken={refreshNonce} />
        <WorkoutExemplarCatalog />
      </div>
    </div>
  );
}
