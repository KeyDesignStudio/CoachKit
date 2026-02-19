import { ExternalWebhookEventStatus, ExternalProvider } from '@prisma/client';

export type ReconciliationIssueSeverity = 'info' | 'warning' | 'error';

export type ReconciliationIssue = {
  id: string;
  provider: ExternalProvider;
  status: ExternalWebhookEventStatus;
  severity: ReconciliationIssueSeverity;
  athleteId: string | null;
  externalAthleteId: string | null;
  externalActivityId: string | null;
  eventType: string | null;
  attempts: number;
  summary: string;
  hint: string;
  lastError: string | null;
  receivedAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
};

function buildSummary(params: {
  provider: ExternalProvider;
  eventType: string | null;
  externalActivityId: string | null;
  externalAthleteId: string | null;
}) {
  const parts = [params.provider];
  if (params.eventType) parts.push(params.eventType);
  if (params.externalActivityId) parts.push(`activity ${params.externalActivityId}`);
  else if (params.externalAthleteId) parts.push(`athlete ${params.externalAthleteId}`);
  return parts.join(' · ');
}

function statusHint(status: ExternalWebhookEventStatus, attempts: number, lastError: string | null) {
  if (status === 'FAILED') {
    return lastError ? `Last error: ${lastError}` : 'Failed after retries. Retry after checking provider credentials.';
  }
  if (status === 'PENDING') {
    return attempts > 0 ? `Pending retry (${attempts} prior attempts).` : 'Pending processing.';
  }
  if (status === 'PROCESSING') return 'Processing in queue.';
  return 'Processed successfully.';
}

function statusSeverity(status: ExternalWebhookEventStatus): ReconciliationIssueSeverity {
  if (status === 'FAILED') return 'error';
  if (status === 'PENDING') return 'warning';
  return 'info';
}

export function normalizeWebhookIssue(row: {
  id: string;
  provider: ExternalProvider;
  status: ExternalWebhookEventStatus;
  athleteId: string | null;
  externalAthleteId: string | null;
  externalActivityId: string | null;
  eventType: string | null;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  updatedAt: Date;
  nextAttemptAt: Date | null;
}) {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    severity: statusSeverity(row.status),
    athleteId: row.athleteId,
    externalAthleteId: row.externalAthleteId,
    externalActivityId: row.externalActivityId,
    eventType: row.eventType,
    attempts: row.attempts,
    summary: buildSummary({
      provider: row.provider,
      eventType: row.eventType,
      externalActivityId: row.externalActivityId,
      externalAthleteId: row.externalAthleteId,
    }),
    hint: statusHint(row.status, row.attempts, row.lastError),
    lastError: row.lastError,
    receivedAt: row.receivedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
  } satisfies ReconciliationIssue;
}
