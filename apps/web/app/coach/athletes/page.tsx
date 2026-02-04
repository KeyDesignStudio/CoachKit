'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Block } from '@/components/ui/Block';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { AthleteDetailDrawer } from '@/components/coach/AthleteDetailDrawer';
import { CreateAthleteModal } from '@/components/coach/CreateAthleteModal';
import { uiH2, uiMuted } from '@/components/ui/typography';

interface AthleteRecord {
  userId: string;
  coachId: string;
  firstName?: string | null;
  lastName?: string | null;
  disciplines: string[];
  trainingPlanSchedule?: {
    frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'AD_HOC';
    dayOfWeek?: number | null;
    weekOfMonth?: 1 | 2 | 3 | 4 | null;
  } | null;
  primaryGoal?: string | null;
  dateOfBirth?: string | null;
  coachNotes?: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    timezone: string;
  };
}

export default function CoachAthletesPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const searchParams = useSearchParams();
  const [athletes, setAthletes] = useState<AthleteRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const loadAthletes = () => {
    if (user?.role !== 'COACH' || !user.userId) {
      return;
    }

    setLoading(true);
    setError('');

    request<{ athletes: AthleteRecord[] }>('/api/coach/athletes')
      .then((data) => setAthletes(data.athletes))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load athletes.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAthletes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.userId]);

  useEffect(() => {
    if (userLoading) return;
    if (!user || user.role !== 'COACH') return;

    const athleteId = String(searchParams.get('athleteId') ?? '').trim();
    if (!athleteId) return;

    setSelectedAthleteId(athleteId);
    setDrawerOpen(true);
  }, [searchParams, user, userLoading]);

  const handleCreateAthlete = async (data: any) => {
    await request('/api/coach/athletes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    loadAthletes();
  };

  const handleAthleteClick = (athleteId: string) => {
    setSelectedAthleteId(athleteId);
    setDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setSelectedAthleteId(null);
  };

  const formatDateOfBirth = (dob: string | null | undefined) => {
    if (!dob) return null;
    const date = new Date(dob);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const dayName = (dayOfWeek: number) => {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
    return names[dayOfWeek] ?? 'Unknown';
  };

  const ordinal = (n: number) => {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return `${n}th`;
  };

  const formatTrainingPlanLine = (athlete: AthleteRecord) => {
    const schedule = athlete.trainingPlanSchedule;
    const freq = schedule?.frequency ?? 'AD_HOC';
    if (freq === 'AD_HOC') return 'Training Plans: Ad hoc';

    const day = schedule?.dayOfWeek ?? null;
    if (day === null || day === undefined) return 'Training Plans: Ad hoc';

    if (freq === 'WEEKLY') return `Training Plans: Weekly on ${dayName(day)}`;
    if (freq === 'FORTNIGHTLY') return `Training Plans: Fortnightly on ${dayName(day)}`;

    const week = schedule?.weekOfMonth ?? null;
    if (!week) return 'Training Plans: Ad hoc';
    return `Training Plans: Monthly (Week ${week}) on ${dayName(day)}`;
  };

  if (userLoading) {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== 'COACH') {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Coach access required.</p>
      </div>
    );
  }

  return (
    <>
      <section className="flex flex-col gap-6">
        {/* Header */}
        <Block>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl md:text-3xl font-semibold">Athlete Profiles</h1>
              <p className="text-sm text-[var(--muted)]">Manage your athlete roster</p>
            </div>
            <Button onClick={() => setModalOpen(true)} className="min-h-[44px]">
              <Icon name="add" size="sm" />
              <span className="ml-2">New Athlete</span>
            </Button>
          </div>
        </Block>

        {/* Error Message */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && <p className="text-center text-[var(--muted)]">Loading athletes...</p>}

        {/* Athletes List */}
        {!loading && athletes.length === 0 && (
          <Block className="text-center py-12">
            <p className="text-[var(--muted)]">No athletes yet. Click &quot;New Athlete&quot; to add your first athlete.</p>
          </Block>
        )}

        {!loading && athletes.length > 0 && (
          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {athletes.map((athlete) => (
              <Block
                key={athlete.userId}
                className="h-full flex flex-col relative group transition-colors hover:border-[var(--ring)]"
              >
                {/* Top: Send Message + Name + email (+ optional DOB) */}
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <button 
                        type="button" 
                        onClick={() => handleAthleteClick(athlete.userId)}
                        className="font-medium truncate hover:underline text-left"
                      >
                       {[athlete.firstName, athlete.lastName].filter(Boolean).join(' ') || athlete.user.name || 'Unnamed Athlete'}
                     </button>
                    <a
                      href={`/coach/notifications?athleteId=${athlete.userId}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-structure)] hover:bg-[var(--bg-element-hover)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                      title="Send Message"
                    >
                      <Icon name="chat" size="sm" />
                    </a>
                  </div>
                  <div className="text-xs text-[var(--muted)] truncate mt-1">{athlete.user.email}</div>
                  <div className="text-xs text-[var(--muted)] mt-1 truncate">{formatTrainingPlanLine(athlete)}</div>
                  {athlete.dateOfBirth ? (
                    <div className="text-xs text-[var(--muted)] mt-1 truncate">DOB: {formatDateOfBirth(athlete.dateOfBirth)}</div>
                  ) : null}
                  {athlete.primaryGoal ? (
                     <div className="text-xs text-[var(--muted)] mt-1 truncate">
                      <span className="font-medium">Goal:</span> {athlete.primaryGoal}
                     </div>
                  ) : null}
                </div>

                {/* Footer: disciplines */}
                <div 
                   className="mt-4 flex items-end justify-end gap-2 flex-wrap flex-1 cursor-pointer"
                   onClick={() => handleAthleteClick(athlete.userId)}
                >
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {athlete.disciplines.map((discipline) => {
                      const theme = getDisciplineTheme(discipline);
                      return (
                        <div
                          key={discipline}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-structure)]"
                          title={discipline}
                        >
                          <Icon name={theme.iconName} size="sm" className={theme.textClass} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Block>
            ))}
          </div>
        )}
      </section>

      {/* Drawer */}
      <AthleteDetailDrawer
        isOpen={drawerOpen}
        athleteId={selectedAthleteId}
        onClose={handleDrawerClose}
      />

      {/* Modal */}
      <CreateAthleteModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleCreateAthlete}
      />
    </>
  );
}
