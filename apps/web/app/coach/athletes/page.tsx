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
import { cn } from '@/lib/cn';

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
  onboardingStatus?: 'DRAFT' | 'ACTIVE';
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
  const [inviteSelectedBusy, setInviteSelectedBusy] = useState(false);
  const [selectedInviteAthleteIds, setSelectedInviteAthleteIds] = useState<Set<string>>(() => new Set());

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

  const handleSendSelectedInvites = async () => {
    const selectedIds = Array.from(selectedInviteAthleteIds);
    if (!selectedIds.length) {
      setToolError('Select at least one athlete card to send intake invites.');
      return;
    }
    setInviteSelectedBusy(true);
    setToolError('');
    setToolSuccess('');
    try {
      const summary = await sendIntakeInvites(selectedIds);
      setToolSuccess(summary);
      setSelectedInviteAthleteIds(new Set());
    } catch (err) {
      setToolError(err instanceof Error ? err.message : 'Failed to send intake invites.');
    } finally {
      setInviteSelectedBusy(false);
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

      setToolSuccess(`Added ${createdAthleteIds.length} athlete${createdAthleteIds.length === 1 ? '' : 's'}.`);
      setSelectedInviteAthleteIds((prev) => {
        const next = new Set(prev);
        createdAthleteIds.forEach((id) => next.add(id));
        return next;
      });
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

  const toggleAthleteSelection = (athleteId: string) => {
    setSelectedInviteAthleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });
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
              className="ml-auto h-10 min-h-0 w-1/3 min-w-[132px] max-w-[180px] px-3 py-1.5 text-sm md:h-auto md:min-h-[44px] md:w-auto md:max-w-none md:px-5 md:py-2"
            >
              <Icon name="add" size="sm" />
              <span className="ml-2">New Athlete</span>
            </Button>
          </div>
        </Block>

        <Block title="Athlete Onboarding Tools">
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Add athletes anytime, then select one or more athlete cards below to send personalized intake invites.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" onClick={handleSendSelectedInvites} disabled={selectedInviteAthleteIds.size === 0 || inviteSelectedBusy || toolsBusy}>
                {inviteSelectedBusy ? 'Sending invites…' : `Send Intake Invites To Selected (${selectedInviteAthleteIds.size})`}
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
              <Button type="button" onClick={handleBulkUpload} disabled={!csvFile || toolsBusy || inviteSelectedBusy}>
                {toolsBusy ? 'Uploading…' : 'Add Athletes From CSV'}
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
                className={cn(
                  'h-full flex flex-col relative group transition-colors hover:border-[var(--ring)]',
                  selectedInviteAthleteIds.has(athlete.userId) ? 'border-[var(--ring)] ring-1 ring-[var(--ring)]' : ''
                )}
              >
                {/* Top: Send Message + Name + email (+ optional DOB) */}
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="font-medium md:truncate text-left">
                        {[athlete.firstName, athlete.lastName].filter(Boolean).join(' ') || athlete.user.name || 'Unnamed Athlete'}
                      </p>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                          athlete.onboardingStatus === 'ACTIVE'
                            ? 'border-emerald-300 bg-emerald-500/12 text-emerald-700 dark:border-emerald-700/70 dark:bg-emerald-500/15 dark:text-emerald-200'
                            : 'border-amber-300 bg-amber-500/12 text-amber-700 dark:border-amber-700/70 dark:bg-amber-500/15 dark:text-amber-200'
                        )}
                        title={athlete.onboardingStatus === 'ACTIVE' ? 'Intake/profile is complete' : 'Intake/profile is still draft'}
                      >
                        {athlete.onboardingStatus === 'ACTIVE' ? 'ACTIVE' : 'DRAFT'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-structure)] hover:bg-[var(--bg-element-hover)] transition-colors cursor-pointer" title="Select athlete for bulk invite">
                        <input
                          type="checkbox"
                          checked={selectedInviteAthleteIds.has(athlete.userId)}
                          onChange={(event) => {
                            event.stopPropagation();
                            toggleAthleteSelection(athlete.userId);
                          }}
                          className="h-4 w-4 cursor-pointer accent-[var(--ring)]"
                        />
                      </label>
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
