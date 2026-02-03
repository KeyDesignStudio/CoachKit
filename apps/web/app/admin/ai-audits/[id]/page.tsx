import Link from 'next/link';
import type { ReactNode } from 'react';

import { requireAiPlanBuilderAuditAdminUserPage, getAiInvocationAuditForAdmin } from '@/modules/ai-plan-builder/server/audit-admin';

export const dynamic = 'force-dynamic';

function Field(props: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="mt-1 break-all text-sm">{props.value}</div>
    </div>
  );
}

export default async function AdminAiAuditDetailPage(props: { params: { id: string } }) {
  const requester = await requireAiPlanBuilderAuditAdminUserPage();
  const audit = await getAiInvocationAuditForAdmin({ id: props.params.id, requester });

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">AI Audit Detail</h1>
        <Link href="/admin/ai-audits" className="text-sm underline">
          Back to list
        </Link>
      </div>

      <div className="mb-6 rounded border p-4">
        <div className="text-sm text-muted-foreground">Audit ID</div>
        <div className="mt-1 break-all font-mono text-sm">{audit.id}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="createdAt" value={audit.createdAt.toISOString()} />
        <Field label="capability" value={audit.capability} />
        <Field label="specVersion" value={audit.specVersion} />
        <Field label="effectiveMode" value={audit.effectiveMode} />
        <Field label="provider" value={audit.provider} />
        <Field label="model" value={audit.model ?? ''} />
        <Field label="durationMs" value={audit.durationMs} />
        <Field label="retryCount" value={audit.retryCount} />
        <Field label="fallbackUsed" value={audit.fallbackUsed ? 'true' : 'false'} />
        <Field label="errorCode" value={audit.errorCode ?? ''} />
        <Field label="actorType" value={audit.actorType} />
        <Field label="actorId" value={audit.actorIdDisplay} />
        <Field label="coachId" value={audit.coachId ?? ''} />
        <Field label="athleteId" value={audit.athleteId ?? ''} />
        <Field label="inputHash" value={<span className="font-mono">{audit.inputHash}</span>} />
        <Field label="outputHash" value={<span className="font-mono">{audit.outputHash}</span>} />
        <Field label="maxOutputTokens" value={audit.maxOutputTokens ?? ''} />
        <Field label="timeoutMs" value={audit.timeoutMs ?? ''} />
      </div>

      <div className="mt-6 text-sm text-muted-foreground">
        Note: audits contain hashes + metadata only. No raw prompts or model outputs are stored.
      </div>
    </div>
  );
}
