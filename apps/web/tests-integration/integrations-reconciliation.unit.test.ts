import { describe, expect, it } from 'vitest';

import { normalizeWebhookIssue } from '@/lib/integrations/reconciliation';

describe('normalizeWebhookIssue', () => {
  it('marks FAILED events as error severity with useful hint', () => {
    const issue = normalizeWebhookIssue({
      id: 'evt-1',
      provider: 'GARMIN',
      status: 'FAILED',
      athleteId: 'ath-1',
      externalAthleteId: 'g-1',
      externalActivityId: 'a-1',
      eventType: 'create',
      attempts: 3,
      lastError: 'rate limited',
      receivedAt: new Date('2026-02-19T00:00:00.000Z'),
      updatedAt: new Date('2026-02-19T01:00:00.000Z'),
      nextAttemptAt: null,
    });

    expect(issue.severity).toBe('error');
    expect(issue.summary).toContain('GARMIN');
    expect(issue.summary).toContain('activity a-1');
    expect(issue.hint).toContain('rate limited');
  });

  it('marks pending events as warning severity', () => {
    const issue = normalizeWebhookIssue({
      id: 'evt-2',
      provider: 'WAHOO',
      status: 'PENDING',
      athleteId: 'ath-1',
      externalAthleteId: 'w-1',
      externalActivityId: null,
      eventType: 'update',
      attempts: 1,
      lastError: null,
      receivedAt: new Date('2026-02-19T00:00:00.000Z'),
      updatedAt: new Date('2026-02-19T01:00:00.000Z'),
      nextAttemptAt: new Date('2026-02-19T02:00:00.000Z'),
    });

    expect(issue.severity).toBe('warning');
    expect(issue.hint).toContain('Pending retry');
  });
});
