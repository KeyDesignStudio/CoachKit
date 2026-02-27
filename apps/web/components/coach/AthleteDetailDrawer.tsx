'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useApi } from '@/components/api-client';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { uiH2, uiMuted } from '@/components/ui/typography';
import type { AthleteBriefJson } from '@/modules/ai/athlete-brief/types';

const DISCIPLINES = ['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'REST', 'OTHER'] as const;

type AthleteProfile = {
  userId: string;
  coachId: string;
  firstName?: string | null;
  lastName?: string | null;
  disciplines: string[];
  primaryGoal?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    timezone: string;
  };
};

type AthleteBrief = AthleteBriefJson;

type AthleteDetailDrawerProps = {
  isOpen: boolean;
  athleteId: string | null;
  onClose: () => void;
  variant?: 'drawer' | 'page';
};

export function AthleteDetailDrawer({
  isOpen,
  athleteId,
  onClose,
  variant = 'drawer',
}: AthleteDetailDrawerProps) {
  const { request } = useApi();
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [brief, setBrief] = useState<AthleteBrief | null>(null);

  useEffect(() => {
    if ((variant === 'drawer' && !isOpen) || !athleteId) {
      setAthlete(null);
      setError('');
      setBrief(null);
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setError('');
      try {
        const [athleteData, briefData] = await Promise.all([
          request<{ athlete: AthleteProfile }>(`/api/coach/athletes/${athleteId}`),
          request<{ brief: AthleteBrief | null }>(`/api/coach/athletes/${athleteId}/athlete-brief/latest`),
        ]);

        setAthlete(athleteData.athlete);
        setBrief(briefData.brief ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load athlete');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, athleteId, request, variant]);

  if (!isOpen && variant === 'drawer') return null;

  const displayName =
    [athlete?.firstName, athlete?.lastName].filter(Boolean).join(' ') || athlete?.user?.name || 'Athlete';
  const displayEmail = athlete?.user?.email || '—';

  const briefSections = (() => {
    if (!brief) return [] as Array<{ title: string; items: string[] }>;
    const sections: Array<{ title: string; items: string[] }> = [];
    const pushLabeled = (items: string[], label: string, value: string | number | null | undefined) => {
      if (value == null || value === '') return;
      items.push(`${label}: ${value}`);
    };

    if (brief.version === 'v1.1') {
      const snapshotItems: string[] = [];
      pushLabeled(snapshotItems, 'Goal', brief.snapshot?.primaryGoal ?? undefined);
      pushLabeled(snapshotItems, 'Experience', brief.snapshot?.experienceLabel ?? undefined);
      if (brief.snapshot?.disciplines?.length) {
        snapshotItems.push(`Disciplines: ${brief.snapshot.disciplines.join(', ')}`);
      }
      if (snapshotItems.length) sections.push({ title: 'Snapshot', items: snapshotItems });

      const trainingItems: string[] = [];
      pushLabeled(trainingItems, 'Weekly minutes', brief.trainingProfile?.weeklyMinutesTarget ?? undefined);
      if (brief.trainingProfile?.availabilityDays?.length) {
        trainingItems.push(`Availability: ${brief.trainingProfile.availabilityDays.join(', ')}`);
      }
      if (trainingItems.length) sections.push({ title: 'Training', items: trainingItems });

      const constraintItems: string[] = [];
      pushLabeled(constraintItems, 'Injury status', brief.constraintsAndSafety?.injuryStatus ?? undefined);
      if (brief.constraintsAndSafety?.painHistory?.length) {
        constraintItems.push(`Pain history: ${brief.constraintsAndSafety.painHistory.join('; ')}`);
      }
      if (constraintItems.length) sections.push({ title: 'Constraints', items: constraintItems });

      return sections;
    }

    const legacyItems: string[] = [];
    pushLabeled(legacyItems, 'Goal', brief.goals?.details ?? undefined);
    pushLabeled(legacyItems, 'Focus', brief.goals?.focus ?? undefined);
    if (legacyItems.length) sections.push({ title: 'Snapshot', items: legacyItems });
    return sections;
  })();

  return (
    <>
      {variant === 'drawer' ? (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      ) : null}

      <div
        className={
          variant === 'drawer'
            ? 'fixed right-0 top-0 z-50 h-full w-full overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl lg:w-[50vw] lg:max-w-[840px]'
            : 'relative w-full'
        }
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-4">
          <h2 className={`${uiH2} md:text-xl font-semibold`}>Athlete Profile</h2>
          {variant === 'drawer' ? (
            <Button type="button" variant="ghost" onClick={onClose}>
              ✕
            </Button>
          ) : null}
        </div>

        <div className="p-6">
          {loading ? (
            <p className={`${uiMuted} text-center`}>Loading...</p>
          ) : error ? (
            <p className="text-center text-sm text-red-600">{error}</p>
          ) : (
            <div className="space-y-6">
              <section className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="flex flex-col gap-1">
                  <div className="text-lg font-semibold">{displayName}</div>
                  <div className="text-sm text-[var(--muted)]">{displayEmail}</div>
                </div>

                {athlete?.primaryGoal ? (
                  <div className="text-sm">
                    <span className="font-medium">Primary goal:</span> {athlete.primaryGoal}
                  </div>
                ) : null}

                {athlete?.disciplines?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {athlete.disciplines.map((discipline) => {
                      const theme = getDisciplineTheme(discipline);
                      return (
                        <div
                          key={discipline}
                          className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                        >
                          <Icon name={theme.iconName} size="sm" className={theme.textClass} />
                          {DISCIPLINES.includes(discipline as any) ? discipline : discipline}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>

              {briefSections.length ? (
                <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                  <h3 className="text-lg font-semibold">Athlete Brief</h3>
                  <div className="space-y-3">
                    {briefSections.map((section) => (
                      <div key={section.title} className="space-y-1">
                        <div className="text-sm font-medium">{section.title}</div>
                        <ul className="space-y-1 text-sm text-[var(--muted)]">
                          {section.items.map((item, idx) => (
                            <li key={`${section.title}-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {athleteId ? (
                <div className="pt-2">
                  <Link href={`/coach/athletes/${athleteId}/profile`} className="inline-block w-full md:w-1/4">
                    <Button type="button" className="min-h-[44px] w-full">
                      Open full profile
                    </Button>
                  </Link>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
