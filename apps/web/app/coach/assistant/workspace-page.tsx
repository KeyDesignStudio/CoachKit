'use client';

import { useCallback, useEffect, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { AskCard } from '@/components/knowledge/AskCard';
import { cn } from '@/lib/cn';
import { tokens } from '@/components/ui/tokens';
import { AiPlanBuilderCoachJourney } from '@/modules/ai-plan-builder/ui/AiPlanBuilderCoachJourney';

import AssistantConsolePage from './console-page';

type AssistAthlete = {
  id: string;
  name: string;
};

type WorkspaceTab = 'PLAN' | 'SUGGESTIONS' | 'ASK';
type PlanningContext = {
  effectiveInput?: {
    conflicts?: Array<unknown>;
    preflight?: {
      hasConflicts?: boolean;
    };
  } | null;
  draftPlan?: {
    id: string;
    visibilityStatus?: string | null;
    selectedKnowledgeSources?: Array<{ title?: string | null }> | null;
    influenceSummary?: { confidence?: string | null } | null;
    noveltyCheck?: { passed?: boolean | null } | null;
  } | null;
  recommendedReferencePlan?: {
    title: string;
    score?: number | null;
    reasons?: string[] | null;
  } | null;
  coachSuggestions?: {
    waitingCount?: number;
  } | null;
};

export default function UnifiedCoachAssistPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();

  const [athletes, setAthletes] = useState<AssistAthlete[]>([]);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('PLAN');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [planningContext, setPlanningContext] = useState<PlanningContext | null>(null);

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

  const loadPlanningContext = useCallback(
    async (athleteId: string) => {
      setContextLoading(true);
      setStatusError('');
      try {
        const data = await request<{ planningContext: PlanningContext }>(
          `/api/coach/athletes/${athleteId}/ai-plan-builder/planning-context`,
          { cache: 'no-store' }
        );
        setPlanningContext(data.planningContext ?? null);
      } catch (err) {
        setPlanningContext(null);
        setStatusError(err instanceof Error ? err.message : 'Failed to load workspace status.');
      } finally {
        setContextLoading(false);
      }
    },
    [request]
  );

  useEffect(() => {
    if (!selectedAthleteId) {
      setPlanningContext(null);
      setStatusError('');
      setContextLoading(false);
      return;
    }
    void loadPlanningContext(selectedAthleteId);
  }, [loadPlanningContext, selectedAthleteId]);

  const draftStatusText = planningContext?.draftPlan ? 'Ready to review' : 'No draft yet';
  const publishedText = planningContext?.draftPlan?.visibilityStatus === 'PUBLISHED' ? 'Published live' : 'Not published';
  const suggestionCount = Number(planningContext?.coachSuggestions?.waitingCount ?? 0);
  const suggestionsText = suggestionCount > 0 ? `${suggestionCount} need coach review` : 'No suggestions waiting';
  const conflictsCount = planningContext?.effectiveInput?.conflicts?.length ?? 0;
  const topReferencePlan = planningContext?.recommendedReferencePlan;
  const knowledgeConfidence = String(planningContext?.draftPlan?.influenceSummary?.confidence ?? '').toLowerCase();
  const noveltyPassed = planningContext?.draftPlan?.noveltyCheck?.passed;

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
            <p className={tokens.typography.sectionLabel}>Coach Planning Workspace</p>
            <h1 className={tokens.typography.h1}>Build, review, and adapt athlete plans with CoachKit AI</h1>
            <p className={cn('mt-1', tokens.typography.bodyMuted)}>
              Select an athlete, review the recommended plan, work through CoachKit suggestions, and keep the plan moving as athlete signals change.
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
          <Button variant={tab === 'PLAN' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab('PLAN')}>
            Plan Workspace
          </Button>
          <Button variant={tab === 'SUGGESTIONS' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab('SUGGESTIONS')}>
            Coach Suggestions
          </Button>
          <Button variant={tab === 'ASK' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab('ASK')}>
            Ask CoachKit
          </Button>
        </div>

        {selectedAthleteId ? (
          <div className="mt-4 grid w-full gap-3 md:grid-cols-3 xl:w-3/4">
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-2')}>
              <p className={tokens.typography.sectionLabel}>Draft</p>
              <p className={tokens.typography.h3}>{contextLoading ? 'Loading…' : draftStatusText}</p>
            </div>
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-2')}>
              <p className={tokens.typography.sectionLabel}>Published</p>
              <p className={tokens.typography.h3}>{contextLoading ? 'Loading…' : publishedText}</p>
            </div>
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-2')}>
              <p className={tokens.typography.sectionLabel}>Coach attention</p>
              <p className={tokens.typography.h3}>{contextLoading ? 'Loading…' : suggestionsText}</p>
            </div>
          </div>
        ) : null}
        {selectedAthleteId && planningContext ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-3')}>
              <p className={tokens.typography.sectionLabel}>Recommended knowledge source</p>
              <p className={tokens.typography.bodySemi}>{topReferencePlan?.title ?? 'No published template match yet'}</p>
              {topReferencePlan?.score != null ? (
                <p className={cn('mt-1', tokens.typography.meta)}>
                  Score {Math.round(Number(topReferencePlan.score))} · {(topReferencePlan.reasons ?? []).slice(0, 2).join(' · ')}
                </p>
              ) : null}
            </div>
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-3')}>
              <p className={tokens.typography.sectionLabel}>Input alignment</p>
              <p className={tokens.typography.bodySemi}>{conflictsCount > 0 ? `${conflictsCount} coach review item(s)` : 'Inputs aligned'}</p>
              <p className={cn('mt-1', tokens.typography.meta)}>
                {planningContext.effectiveInput?.preflight?.hasConflicts ? 'Intake, profile, and approved brief disagree on one or more planning fields.' : 'Profile, intake, and approved brief are aligned.'}
              </p>
            </div>
            <div className={cn(tokens.borders.default, tokens.radius.card, 'bg-[var(--bg-card)] px-3 py-3')}>
              <p className={tokens.typography.sectionLabel}>AI planning trace</p>
              <p className={tokens.typography.bodySemi}>
                {knowledgeConfidence ? `Knowledge confidence: ${knowledgeConfidence}` : 'No draft influence trace yet'}
              </p>
              <p className={cn('mt-1', tokens.typography.meta)}>
                {noveltyPassed == null ? 'Novelty guard will appear after a draft is generated.' : noveltyPassed ? 'Current draft passes similarity guardrails.' : 'Current draft needs coach review for high source similarity.'}
              </p>
            </div>
          </div>
        ) : null}
        {statusError ? (
          <p className={cn('mt-3 rounded-xl bg-amber-50 px-3 py-2 text-amber-800', tokens.typography.body)}>{statusError}</p>
        ) : null}
      </Block>

      {error ? <p className={cn('rounded-xl bg-rose-50 px-3 py-2 text-rose-700', tokens.typography.body)}>{error}</p> : null}

      {!selectedAthleteId ? (
        <Block>
          <p className={tokens.typography.bodyMuted}>Select an athlete to continue.</p>
        </Block>
      ) : null}

      {selectedAthleteId && tab === 'PLAN' ? (
        <AiPlanBuilderCoachJourney athleteId={selectedAthleteId} />
      ) : null}

      {selectedAthleteId && tab === 'SUGGESTIONS' ? (
        <AssistantConsolePage athleteId={selectedAthleteId} embedded />
      ) : null}

      {selectedAthleteId && tab === 'ASK' ? (
        <AskCard
          athleteId={selectedAthleteId}
          aiPlanDraftId={planningContext?.draftPlan?.id ?? null}
          placeholder="Ask about this athlete, their current draft, training risks, progression, recovery, or coaching options."
        />
      ) : null}
    </section>
  );
}
