'use client';

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
        <h1 className="text-xl font-semibold">Plan Library (PlanSource v1)</h1>
        <div className="text-sm text-muted-foreground">Admin: {adminEmail}</div>
      </div>

      <div className="space-y-6">
        <PlanLibraryIngestForm onIngested={handleIngested} />
        <PlanLibrarySourceCatalog refreshNonce={refreshNonce} />
        <WorkoutExemplarCatalog />
      </div>
    </div>
  );
}
