'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/components/api-client';
import { useUser } from '@/components/user-context';
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
  const { user } = useUser();
  const { request } = useApi();
  const [athletes, setAthletes] = useState<AthleteRecord[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const loadAthletes = () => {
    if (user.role !== 'COACH' || !user.userId) {
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
  }, [user.role, user.userId]);

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

  if (user.role !== 'COACH') {
    return (
      <div className="px-6 pt-6">
        <p className="text-slate-600">Please switch to a coach identity to see your roster.</p>
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
          <div className="space-y-3">
            {athletes.map((athlete) => (
              <button
                key={athlete.userId}
                onClick={() => handleAthleteClick(athlete.userId)}
                className="w-full rounded-2xl border border-white/30 bg-white/60 p-4 text-left shadow-sm backdrop-blur-xl transition-all hover:bg-white/80 hover:shadow-md min-h-[44px]"
              >
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-4">
                  {/* Left: Name, Email, DOB */}
                  <div className="flex-1 space-y-1">
                    <h3 className="font-semibold text-slate-900">
                      {athlete.user.name || 'Unnamed Athlete'}
                    </h3>
                    <p className="text-sm text-slate-600">{athlete.user.email}</p>
                    {athlete.dateOfBirth && (
                      <p className="text-xs text-slate-500">DOB: {formatDateOfBirth(athlete.dateOfBirth)}</p>
                    )}
                  </div>

                  {/* Right section: Cadence + Disciplines */}
                  <div className="flex items-center gap-3">
                    {/* Program Cadence */}
                    <div className="flex flex-col items-center justify-center rounded-xl border border-white/30 bg-white/40 px-4 py-2">
                      <div className="text-2xl font-bold text-slate-900">{athlete.planCadenceDays}</div>
                      <div className="text-xs text-slate-600">Cadence</div>
                    </div>

                    {/* Disciplines */}
                    <div className="flex items-center gap-2 flex-wrap">
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
