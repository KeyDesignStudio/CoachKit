'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Papa from 'papaparse';
import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Block } from '@/components/ui/Block';
import { getDisciplineTheme } from '@/components/ui/disciplineTheme';
import { AthleteDetailDrawer } from '@/components/coach/AthleteDetailDrawer';
import { CreateAthleteModal } from '@/components/coach/CreateAthleteModal';
import { formatDateShortAu } from '@/lib/client-date';

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

type AthleteSeedRow = {
  firstName: string;
  lastName: string;
  gender: string;
  email: string;
};

function normalizeHeader(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

function parseCsvRows(text: string): AthleteSeedRow[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => normalizeHeader(h),
  });

  if (parsed.errors?.length) {
    throw new Error(`CSV parse error: ${parsed.errors[0]?.message ?? 'Invalid file.'}`);
  }

  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  return rows
    .map((row) => ({
      firstName: String(row.firstname ?? '').trim(),
      lastName: String(row.lastname ?? '').trim(),
      gender: String(row.gender ?? '').trim(),
      email: String(row.email ?? '').trim().toLowerCase(),
    }))
    .filter((row) => row.firstName && row.lastName && row.email);
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
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [toolsBusy, setToolsBusy] = useState(false);
  const [toolError, setToolError] = useState('');
  const [toolSuccess, setToolSuccess] = useState('');
  const [inviteBusyAthleteId, setInviteBusyAthleteId] = useState<string | null>(null);
  const [inviteAllBusy, setInviteAllBusy] = useState(false);

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

  const sendIntakeInvites = async (athleteIds: string[]) => {
    const payload = await request<{
      sentCount: number;
      failedCount: number;
      results: Array<{ athleteId: string; sent: boolean; error: string | null; inviteLink: string }>;
    }>('/api/coach/onboarding/invites', {
      method: 'POST',
      data: {
        athleteIds,
        redirectPath: '/athlete/intake',
      },
    });

    const firstFailure = payload.results.find((row) => !row.sent && row.error)?.error;
    const summary = `Invites sent: ${payload.sentCount}, failed: ${payload.failedCount}.`;
    if (payload.failedCount > 0 && firstFailure) {
      throw new Error(`${summary} First error: ${firstFailure}`);
    }
    return summary;
  };

  const handleSendSingleInvite = async (athleteId: string) => {
    setInviteBusyAthleteId(athleteId);
    setToolError('');
    setToolSuccess('');
    try {
      const summary = await sendIntakeInvites([athleteId]);
      setToolSuccess(summary);
    } catch (err) {
      setToolError(err instanceof Error ? err.message : 'Failed to send intake invite.');
    } finally {
      setInviteBusyAthleteId(null);
    }
  };

  const handleSendAllInvites = async () => {
    if (!athletes.length) return;
    setInviteAllBusy(true);
    setToolError('');
    setToolSuccess('');
    try {
      const summary = await sendIntakeInvites(athletes.map((athlete) => athlete.userId));
      setToolSuccess(summary);
    } catch (err) {
      setToolError(err instanceof Error ? err.message : 'Failed to send intake invites.');
    } finally {
      setInviteAllBusy(false);
    }
  };

  const handleBulkUpload = async () => {
    if (!csvFile) {
      setToolError('Choose a CSV file first.');
      return;
    }

    setToolsBusy(true);
    setToolError('');
    setToolSuccess('');

    try {
      const text = await csvFile.text();
      const rows = parseCsvRows(text);
      if (!rows.length) {
        throw new Error('CSV has no valid rows. Required headers: firstName, lastName, email.');
      }

      const createdAthleteIds: string[] = [];
      for (const row of rows) {
        const created = await request<{ athlete: { userId: string } }>('/api/coach/athletes', {
          method: 'POST',
          data: {
            name: `${row.firstName} ${row.lastName}`.trim(),
            firstName: row.firstName,
            lastName: row.lastName,
            email: row.email,
            timezone: user?.timezone || 'Australia/Brisbane',
            disciplines: ['RUN', 'BIKE', 'SWIM'],
          },
        });

        createdAthleteIds.push(String(created.athlete.userId));

        if (row.gender) {
          await request(`/api/coach/athletes/${encodeURIComponent(created.athlete.userId)}`, {
            method: 'PATCH',
            data: { gender: row.gender },
          });
        }
      }

      const inviteSummary = await sendIntakeInvites(createdAthleteIds);
      setToolSuccess(`Added ${createdAthleteIds.length} athlete${createdAthleteIds.length === 1 ? '' : 's'}. ${inviteSummary}`);
      setCsvFile(null);
      loadAthletes();
    } catch (err) {
      setToolError(err instanceof Error ? err.message : 'Bulk upload failed.');
    } finally {
      setToolsBusy(false);
    }
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
    return formatDateShortAu(date) || dob;
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
          <div className="flex items-start justify-between gap-3 md:items-center">
            <div className="space-y-1">
              <h1 className="text-2xl md:text-3xl font-semibold">Athlete Profiles</h1>
              <p className="text-sm text-[var(--muted)]">Manage your athlete roster</p>
            </div>
            <Button
              onClick={() => setModalOpen(true)}
              className="ml-auto h-10 min-h-0 w-1/3 min-w-[132px] max-w-[180px] bg-black px-3 py-1.5 text-sm text-white hover:bg-black/90 dark:bg-black dark:hover:bg-black/90 md:h-auto md:min-h-[44px] md:w-auto md:max-w-none md:px-5 md:py-2"
            >
              <Icon name="add" size="sm" />
              <span className="ml-2">New Athlete</span>
            </Button>
          </div>
        </Block>

        <Block title="Athlete Onboarding Tools">
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Add athletes anytime and send each athlete a personalized sign-up link to complete their intake form.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" onClick={handleSendAllInvites} disabled={!athletes.length || inviteAllBusy || toolsBusy}>
                {inviteAllBusy ? 'Sending invites…' : 'Send Intake Invites To All Athletes'}
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="space-y-1">
                <span className="text-sm text-[var(--muted)]">Bulk upload CSV</span>
                <input
                  type="file"
                  accept=".csv,text/csv,application/vnd.ms-excel"
                  onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)}
                  className="block w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--bg-structure)] file:px-3 file:py-1.5 file:text-sm"
                />
              </label>
              <Button type="button" onClick={handleBulkUpload} disabled={!csvFile || toolsBusy || inviteAllBusy}>
                {toolsBusy ? 'Uploading…' : 'Add Athletes From CSV + Send Intake Invites'}
              </Button>
            </div>
            <p className="text-xs text-[var(--muted)]">
              CSV headers: <span className="font-medium">firstName,lastName,email</span> (optional: <span className="font-medium">gender</span>).
            </p>
          </div>
        </Block>

        {/* Error Message */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        {toolError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {toolError}
          </div>
        )}
        {toolSuccess && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {toolSuccess}
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
                    <p className="font-medium md:truncate text-left">
                      {[athlete.firstName, athlete.lastName].filter(Boolean).join(' ') || athlete.user.name || 'Unnamed Athlete'}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleSendSingleInvite(athlete.userId);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-structure)] hover:bg-[var(--bg-element-hover)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                        title="Send intake invite"
                        disabled={inviteBusyAthleteId === athlete.userId || toolsBusy || inviteAllBusy}
                      >
                        <Icon name="inbox" size="sm" />
                      </button>
                      <a
                        href={`/coach/notifications?athleteId=${athlete.userId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-structure)] hover:bg-[var(--bg-element-hover)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                        title="Send Message"
                      >
                        <Icon name="chat" size="sm" />
                      </a>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAthleteClick(athlete.userId)}
                    className="mt-1 w-full text-left"
                  >
                    <div className="text-xs text-[var(--muted)] md:truncate mt-1">{athlete.user.email}</div>
                    <div className="text-xs text-[var(--muted)] mt-1 md:truncate">{formatTrainingPlanLine(athlete)}</div>
                    {athlete.dateOfBirth ? (
                      <div className="text-xs text-[var(--muted)] mt-1 md:truncate">DOB: {formatDateOfBirth(athlete.dateOfBirth)}</div>
                    ) : null}
                    {athlete.primaryGoal ? (
                       <div className="text-xs text-[var(--muted)] mt-1 md:truncate">
                        <span className="font-medium">Goal:</span> {athlete.primaryGoal}
                       </div>
                    ) : null}

                    {/* Footer: disciplines */}
                    <div className="mt-4 flex items-end justify-end gap-2 flex-wrap flex-1 cursor-pointer">
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
                  </button>
                </div>
                
                <div className="pointer-events-none absolute inset-0 rounded-2xl ring-0 transition group-hover:ring-1 group-hover:ring-[var(--ring)]" aria-hidden />
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
