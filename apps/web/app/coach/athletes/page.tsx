'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { AthleteDetailDrawer } from '@/components/coach/AthleteDetailDrawer';
import { CreateAthleteModal } from '@/components/coach/CreateAthleteModal';

interface AthleteRecord {
  userId: string;
  coachId: string;
  disciplines: string[];
  planCadenceDays: number;
  goalsText?: string | null;
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

  const handleSaved = () => {
    loadAthletes();
  };

  const handleDeleted = () => {
    loadAthletes();
  };

  const formatDateOfBirth = (dob: string | null | undefined) => {
    if (!dob) return null;
    const date = new Date(dob);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (userLoading) {
    return (
      <div className="px-6 pt-6">
        <p className="text-slate-600">Loading...</p>
      </div>
    );
  }

  if (!user || user.role !== 'COACH') {
    return (
      <div className="px-6 pt-6">
        <p className="text-slate-600">Coach access required.</p>
      </div>
    );
  }

  return (
    <>
      <section className="space-y-4 px-4 py-4 md:px-6 md:pt-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="mb-1 text-xl md:text-2xl font-bold">Athlete Profiles</h1>
            <p className="text-xs md:text-sm text-slate-600">Manage your athlete roster</p>
          </div>
          <Button onClick={() => setModalOpen(true)} className="min-h-[44px]">
            <Icon name="add" size="sm" />
            <span className="ml-2">New Athlete</span>
          </Button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && <p className="text-center text-slate-500">Loading athletes...</p>}

        {/* Athletes List */}
        {!loading && athletes.length === 0 && (
          <div className="rounded-3xl border border-white/30 bg-white/40 p-8 text-center backdrop-blur-xl">
            <p className="text-slate-600">No athletes yet. Click &quot;New Athlete&quot; to add your first athlete.</p>
          </div>
        )}

        {!loading && athletes.length > 0 && (
          <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {athletes.map((athlete) => (
              <button
                type="button"
                key={athlete.userId}
                onClick={() => handleAthleteClick(athlete.userId)}
                className="rounded-2xl border border-white/30 bg-white/50 hover:bg-white/70 transition-colors p-4 cursor-pointer text-left min-w-0 min-h-[44px]"
              >
                {/* Top: Name + email (+ optional DOB) */}
                <div className="min-w-0">
                  <div className="font-medium truncate">{athlete.user.name || 'Unnamed Athlete'}</div>
                  <div className="text-sm text-[var(--muted)] truncate">{athlete.user.email}</div>
                  {athlete.dateOfBirth ? (
                    <div className="text-xs text-[var(--muted)] mt-1 truncate">DOB: {formatDateOfBirth(athlete.dateOfBirth)}</div>
                  ) : null}
                </div>

                {/* Footer: Cadence + disciplines */}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex-shrink-0 inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/60 px-2.5 py-1 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">{athlete.planCadenceDays}</span>
                    <span className="text-[var(--muted)]">day cadence</span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {athlete.disciplines.map((discipline) => {
                      const theme = getDisciplineTheme(discipline);
                      return (
                        <div
                          key={discipline}
                          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/30 bg-white/40"
                          title={discipline}
                        >
                          <Icon name={theme.iconName} size="md" className={theme.textClass} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Drawer */}
      <AthleteDetailDrawer
        isOpen={drawerOpen}
        athleteId={selectedAthleteId}
        onClose={handleDrawerClose}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
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
