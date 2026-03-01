'use client';

import { useCallback, useEffect, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { tokens } from '@/components/ui/tokens';
import { AiPlanBuilderCoachJourney } from '@/modules/ai-plan-builder/ui/AiPlanBuilderCoachJourney';

import AssistantConsolePage from './console-page';

type AssistAthlete = {
  id: string;
  name: string;
};

type WorkspaceTab = 'BUILD' | 'SIGNALS';
type AiDraftStatus = {
  id: string;
  visibilityStatus?: string | null;
};
type PublishStatus = {
  visibilityStatus?: string | null;
};

export default function UnifiedCoachAssistPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const [athletes, setAthletes] = useState<AssistAthlete[]>([]);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('BUILD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [draftStatus, setDraftStatus] = useState<AiDraftStatus | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [signalsWaitingCount, setSignalsWaitingCount] = useState(0);

  const loadAthletes = useCallback(async () => {
    if (!user?.userId || (user.role !== 'COACH' && user.role !== 'ADMIN')) return;

    setLoading(true);
    setError('');
    try {
      const data = await request<{ athletes: AssistAthlete[] }>('/api/coach/assistant/athletes', {
        cache: 'no-store',
      });
      const rows = Array.isArray(data.athletes) ? data.athletes : [];
      setAthletes(rows);

      if (!rows.length) {
        setSelectedAthleteId(null);
        return;
      }

      setSelectedAthleteId((prev) => (prev && rows.some((row) => row.id === prev) ? prev : rows[0].id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load athletes.');
      setAthletes([]);
      setSelectedAthleteId(null);
    } finally {
      setLoading(false);
    }
  }, [request, user?.role, user?.userId]);

  useEffect(() => {
    if (user?.role === 'COACH' || user?.role === 'ADMIN') {
      void loadAthletes();
    }
  }, [loadAthletes, user?.role]);

  const loadStatusStrip = useCallback(
    async (athleteId: string) => {
      setStatusLoading(true);
      setStatusError('');
      try {
        const [draftData, detectionsData] = await Promise.all([
          request<{ draftPlan: AiDraftStatus | null }>(
            `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/latest`,
            { cache: 'no-store' }
          ),
          request<{ total?: number }>('/api/coach/assistant/detections?state=NEEDS_ATTENTION&limit=1&offset=0&athleteId=' + encodeURIComponent(athleteId), {
            cache: 'no-store',
          }),
        ]);

        const nextDraft = draftData.draftPlan ?? null;
        setDraftStatus(nextDraft);
        setSignalsWaitingCount(Number(detectionsData.total ?? 0));

        if (nextDraft?.id) {
          try {
            const publishData = await request<{ publishStatus: PublishStatus | null }>(
              `/api/coach/athletes/${athleteId}/ai-plan-builder/draft-plan/publish-status?aiPlanDraftId=${encodeURIComponent(nextDraft.id)}`,
              { cache: 'no-store' }
            );
            setPublishStatus(publishData.publishStatus ?? null);
          } catch {
            setPublishStatus(null);
          }
        } else {
          setPublishStatus(null);
        }
      } catch (err) {
        setDraftStatus(null);
        setPublishStatus(null);
        setSignalsWaitingCount(0);
        setStatusError(err instanceof Error ? err.message : 'Failed to load workspace status.');
      } finally {
        setStatusLoading(false);
      }
    },
    [request]
  );

  useEffect(() => {
    if (!selectedAthleteId) {
      setDraftStatus(null);
      setPublishStatus(null);
      setSignalsWaitingCount(0);
      setStatusError('');
      setStatusLoading(false);
      return;
    }
    void loadStatusStrip(selectedAthleteId);
  }, [loadStatusStrip, selectedAthleteId]);

  const draftStatusText = draftStatus ? 'Available' : 'None';
  const publishedText = publishStatus?.visibilityStatus === 'PUBLISHED' ? 'Published' : 'Not published';
  const signalsText = signalsWaitingCount > 0 ? `${signalsWaitingCount} waiting` : 'None waiting';

  if (userLoading) {
    return <p className={tokens.typography.bodyMuted}>Loading CoachKit Assist…</p>;
  }

  if (!user || (user.role !== 'COACH' && user.role !== 'ADMIN')) {
    return <p className={tokens.typography.bodyMuted}>Coach access required.</p>;
  }

  return (
    <section className={cn(tokens.spacing.dashboardSectionGap)}>
      <Block>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className={tokens.typography.sectionLabel}>CoachKit Assist</p>
            <h1 className={tokens.typography.h1}>AI Plan Builder + AI Signals</h1>
            <p className={cn('mt-1', tokens.typography.bodyMuted)}>
              Select an athlete, build and publish their personalised plan, then act on ongoing AI-detected signals in the same workspace.
            </p>
          </div>

          <div className="w-full xl:w-[360px]">
            <label className={cn('mb-1 block', tokens.typography.sectionLabel)}>Selected athlete</label>
            <select
              className={cn('w-full', tokens.typography.body, tokens.borders.input, tokens.radius.input, 'bg-[var(--bg-card)] px-3 py-2')}
              value={selectedAthleteId ?? ''}
              onChange={(event) => setSelectedAthleteId(event.target.value || null)}
              disabled={loading || athletes.length === 0}
            >
              {athletes.length === 0 ? <option value="">No athletes</option> : null}
              {athletes.map((athlete) => (
                <option key={athlete.id} value={athlete.id}>
                  {athlete.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-structure)] p-1">
          <Button variant={tab === 'BUILD' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab('BUILD')}>
            Build & Publish
          </Button>
          <Button variant={tab === 'SIGNALS' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab('SIGNALS')}>
            Signals Assistant
          </Button>
        </div>

        {selectedAthleteId && tab === 'SIGNALS' ? (
          <div className="mt-4 grid w-full gap-3 md:grid-cols-3 xl:w-1/2">
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-2')}>
              <p className={tokens.typography.sectionLabel}>Draft</p>
              <p className={tokens.typography.h3}>{statusLoading ? 'Loading…' : draftStatusText}</p>
            </div>
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-2')}>
              <p className={tokens.typography.sectionLabel}>Published</p>
              <p className={tokens.typography.h3}>{statusLoading ? 'Loading…' : publishedText}</p>
            </div>
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-2')}>
              <p className={tokens.typography.sectionLabel}>Signals waiting</p>
              <p className={tokens.typography.h3}>{statusLoading ? 'Loading…' : signalsText}</p>
            </div>
          </div>
        ) : null}
        {tab === 'SIGNALS' && statusError ? (
          <p className={cn('mt-3 rounded-xl bg-amber-50 px-3 py-2 text-amber-800', tokens.typography.body)}>{statusError}</p>
        ) : null}
      </Block>

      {error ? <p className={cn('rounded-xl bg-rose-50 px-3 py-2 text-rose-700', tokens.typography.body)}>{error}</p> : null}

      {!selectedAthleteId ? (
        <Block>
          <p className={tokens.typography.bodyMuted}>Select an athlete to continue.</p>
        </Block>
      ) : null}

      {selectedAthleteId && tab === 'BUILD' ? (
        <AiPlanBuilderCoachJourney athleteId={selectedAthleteId} />
      ) : null}

      {selectedAthleteId && tab === 'SIGNALS' ? (
        <AssistantConsolePage athleteId={selectedAthleteId} embedded />
      ) : null}
    </section>
  );
}
