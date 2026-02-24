'use client';

import { useMemo, useState } from 'react';
import Papa from 'papaparse';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/SelectField';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { cn } from '@/lib/cn';

type StepKey = 'SQUAD' | 'ATHLETES' | 'TRAINING_REQUEST' | 'CALENDAR' | 'MESSAGING';

type OnboardingStep = {
  key: StepKey;
  title: string;
  subtitle: string;
};

type AthleteSeedRow = {
  firstName: string;
  lastName: string;
  gender: string;
  email: string;
};

type CreatedAthlete = {
  id: string;
  name: string;
  email: string;
  inviteLink: string;
  inviteSent: boolean;
  inviteError: string | null;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  request: <T,>(path: string, options?: any) => Promise<T>;
  initialTimezone: string;
  initialSquadName: string;
};

const STEPS: OnboardingStep[] = [
  {
    key: 'SQUAD',
    title: 'Step 1: Set Up Your Squad',
    subtitle: 'Set your squad name, upload logo, and confirm timezone.',
  },
  {
    key: 'ATHLETES',
    title: 'Step 2: Add Athletes',
    subtitle: 'Add one athlete manually or bulk import a CSV exported from Excel.',
  },
  {
    key: 'TRAINING_REQUEST',
    title: 'Step 3: Training Request + AI Plan Builder',
    subtitle: 'How athletes request blocks and how you build plans with CoachKit AI.',
  },
  {
    key: 'CALENDAR',
    title: 'Step 4: Calendar, Group Sessions, and Integrations',
    subtitle: 'Scheduling workflow, recurring group sessions, Strava sync, and calendar export.',
  },
  {
    key: 'MESSAGING',
    title: 'Step 5: Messaging and Notifications',
    subtitle: 'Use inbox/sent workflows for individual, multi-athlete, or squad-wide communication.',
  },
];

function normalizeHeader(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

function buildInviteLink(email: string) {
  if (typeof window === 'undefined') return '';
  const base = window.location.origin;
  const redirect = encodeURIComponent('/athlete/training-request');
  return `${base}/sign-up?redirect_url=${redirect}&email_address=${encodeURIComponent(email)}`;
}

function buildInviteMailto(athlete: CreatedAthlete) {
  const subject = encodeURIComponent('You are invited to CoachKit');
  const body = encodeURIComponent(
    `Hi ${athlete.name},\n\nYou have been invited to CoachKit.\n\nUse your personal link to sign up and complete your training request:\n${athlete.inviteLink}\n\nSee you inside,\nCoach`
  );
  return `mailto:${encodeURIComponent(athlete.email)}?subject=${subject}&body=${body}`;
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

export function CoachOnboardingModal(props: Props) {
  const { isOpen, onClose, onComplete, request, initialTimezone, initialSquadName } = props;
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [squadName, setSquadName] = useState(initialSquadName || 'CoachKit');
  const [timezone, setTimezone] = useState(initialTimezone || 'Australia/Brisbane');
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const [addMode, setAddMode] = useState<'MANUAL' | 'CSV'>('MANUAL');
  const [manualFirstName, setManualFirstName] = useState('');
  const [manualLastName, setManualLastName] = useState('');
  const [manualGender, setManualGender] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [createdAthletes, setCreatedAthletes] = useState<CreatedAthlete[]>([]);

  const currentStep = STEPS[stepIndex] ?? STEPS[0];
  const progressPct = Math.round(((stepIndex + 1) / STEPS.length) * 100);

  const canGoNext = useMemo(() => {
    if (currentStep.key === 'SQUAD') {
      return Boolean(String(squadName).trim() && String(timezone).trim());
    }
    return true;
  }, [currentStep.key, squadName, timezone]);

  const finish = () => {
    if (dontShowAgain && typeof window !== 'undefined') {
      window.localStorage.setItem('coachkit-coach-onboarding-skip', '1');
    }
    onComplete();
  };

  const saveSquadStep = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await request('/api/coach/branding', {
        method: 'PATCH',
        data: { displayName: String(squadName).trim() || 'CoachKit' },
      });
      await request('/api/me/timezone', {
        method: 'PATCH',
        data: { timezone: String(timezone).trim() },
      });

      if (logoFile) {
        const form = new FormData();
        form.append('file', logoFile);
        const response = await fetch('/api/coach/branding/logo?variant=light', {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error?.message || 'Logo upload failed.');
        }
      }

      setSuccess('Squad details saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save squad details.');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const createAthlete = async (row: AthleteSeedRow) => {
    const firstName = String(row.firstName || '').trim();
    const lastName = String(row.lastName || '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    if (!firstName || !lastName || !email) return null;

    const created = await request<{ athlete: { userId: string; user: { name: string | null; email: string | null } } }>(
      '/api/coach/athletes',
      {
        method: 'POST',
        data: {
          name: `${firstName} ${lastName}`.trim(),
          firstName,
          lastName,
          email,
          timezone: String(timezone).trim() || 'Australia/Brisbane',
          disciplines: ['RUN', 'BIKE', 'SWIM'],
        },
      }
    );

    const athleteId = String(created.athlete.userId);
    if (row.gender) {
      await request(`/api/coach/athletes/${encodeURIComponent(athleteId)}`, {
        method: 'PATCH',
        data: { gender: String(row.gender).trim() },
      });
    }

    const inviteLink = buildInviteLink(email);
    const name = String(created.athlete.user?.name ?? `${firstName} ${lastName}`.trim());
    return { id: athleteId, name, email, inviteLink, inviteSent: false, inviteError: null } satisfies CreatedAthlete;
  };

  const sendInvites = async (athletes: CreatedAthlete[]) => {
    if (!athletes.length) return athletes;

    const response = await request<{
      results: Array<{
        athleteId: string;
        inviteLink: string;
        sent: boolean;
        error: string | null;
      }>;
      sentCount: number;
      failedCount: number;
    }>('/api/coach/onboarding/invites', {
      method: 'POST',
      data: {
        athleteIds: athletes.map((a) => a.id),
      },
    });

    const byAthleteId = new Map(response.results.map((r) => [String(r.athleteId), r] as const));
    return athletes.map((athlete) => {
      const invite = byAthleteId.get(String(athlete.id));
      if (!invite) return athlete;
      return {
        ...athlete,
        inviteLink: invite.inviteLink || athlete.inviteLink,
        inviteSent: Boolean(invite.sent),
        inviteError: invite.error ? String(invite.error) : null,
      };
    });
  };

  const addManualAthlete = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await createAthlete({
        firstName: manualFirstName,
        lastName: manualLastName,
        gender: manualGender,
        email: manualEmail,
      });
      if (!result) throw new Error('Enter first name, last name, and email.');
      const [inviteResult] = await sendInvites([result]);
      setCreatedAthletes((prev) => [inviteResult, ...prev]);
      setSuccess(
        inviteResult?.inviteSent
          ? 'Athlete created and invite email sent.'
          : 'Athlete created. Invite email failed, but link is available to send manually.'
      );
      setManualFirstName('');
      setManualLastName('');
      setManualGender('');
      setManualEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create athlete.');
    } finally {
      setSaving(false);
    }
  };

  const importCsvAthletes = async () => {
    if (!csvFile) {
      setError('Upload a CSV file first. Use headers: firstName, lastName, gender, email.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const text = await csvFile.text();
      const rows = parseCsvRows(text);
      if (!rows.length) throw new Error('No valid rows found. Required headers: firstName, lastName, gender, email.');

      const created: CreatedAthlete[] = [];
      for (const row of rows) {
        const next = await createAthlete(row);
        if (next) created.push(next);
      }

      if (!created.length) throw new Error('No athletes were created from this file.');
      const inviteResults = await sendInvites(created);
      const sentCount = inviteResults.filter((a) => a.inviteSent).length;
      const failedCount = inviteResults.length - sentCount;
      setCreatedAthletes((prev) => [...inviteResults, ...prev]);
      setSuccess(
        failedCount
          ? `${inviteResults.length} athletes imported. ${sentCount} invite emails sent, ${failedCount} failed (manual links available).`
          : `${inviteResults.length} athletes imported and invite emails sent.`
      );
      setCsvFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk import failed.');
    } finally {
      setSaving(false);
    }
  };

  const onNext = async () => {
    if (currentStep.key === 'SQUAD') {
      await saveSquadStep();
    }
    setError('');
    setSuccess('');
    setStepIndex((p) => Math.min(STEPS.length - 1, p + 1));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 p-3 md:p-6" role="dialog" aria-modal="true" aria-label="Coach onboarding">
      <div className="mx-auto max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.35)]">
        <div className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">Coach onboarding</div>
              <h2 className="text-xl font-semibold text-[var(--text)]">{currentStep.title}</h2>
              <p className="mt-1 text-sm text-[var(--fg-muted)]">{currentStep.subtitle}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-[var(--fg-muted)] hover:bg-[var(--bg-structure)]" aria-label="Close onboarding">
              ×
            </button>
          </div>

          <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--bar-track)]">
            <div className="h-full rounded-full bg-blue-500/80 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="grid grid-cols-5 gap-2 text-[11px] text-[var(--fg-muted)]">
            {STEPS.map((step, idx) => (
              <div key={step.key} className={cn('truncate', idx === stepIndex ? 'font-semibold text-[var(--text)]' : '')}>
                {idx + 1}. {step.key === 'TRAINING_REQUEST' ? 'Plan Builder' : step.key}
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 md:p-6">
          {currentStep.key === 'SQUAD' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-medium">Squad name</div>
                <Input value={squadName} onChange={(e) => setSquadName(e.target.value)} placeholder="e.g. Multisport GOLD Squad" />
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">Timezone</div>
                <TimezoneSelect value={timezone} onChange={setTimezone} />
              </div>
              <div className="md:col-span-2">
                <div className="mb-1 text-sm font-medium">Upload squad logo (optional)</div>
                <Input type="file" accept="image/*" onChange={(e) => setLogoFile(e.currentTarget.files?.[0] ?? null)} />
                <div className="mt-1 text-xs text-[var(--fg-muted)]">This syncs straight into Coach Settings branding.</div>
              </div>
            </div>
          ) : null}

          {currentStep.key === 'ATHLETES' ? (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Button type="button" size="sm" variant={addMode === 'MANUAL' ? 'primary' : 'secondary'} onClick={() => setAddMode('MANUAL')}>
                  Add one athlete
                </Button>
                <Button type="button" size="sm" variant={addMode === 'CSV' ? 'primary' : 'secondary'} onClick={() => setAddMode('CSV')}>
                  Import CSV
                </Button>
              </div>

              {addMode === 'MANUAL' ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input value={manualFirstName} onChange={(e) => setManualFirstName(e.target.value)} placeholder="First name" />
                  <Input value={manualLastName} onChange={(e) => setManualLastName(e.target.value)} placeholder="Last name" />
                  <SelectField value={manualGender} onChange={(e) => setManualGender(e.target.value)}>
                    <option value="">Gender (optional)</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Non-binary">Non-binary</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </SelectField>
                  <Input value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="Email" />
                  <div className="md:col-span-2">
                    <Button type="button" variant="primary" disabled={saving} onClick={() => void addManualAthlete()}>
                      {saving ? 'Adding…' : 'Add athlete and generate invite'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    type="file"
                    accept=".csv,text/csv,application/vnd.ms-excel"
                    onChange={(e) => setCsvFile(e.currentTarget.files?.[0] ?? null)}
                  />
                  <div className="text-xs text-[var(--fg-muted)]">
                    Required headers: <span className="font-medium">firstName, lastName, gender, email</span>
                    <br />
                    Tip: if using Excel, export as CSV first.
                  </div>
                  <div className="md:col-span-2">
                    <Button type="button" variant="primary" disabled={saving} onClick={() => void importCsvAthletes()}>
                      {saving ? 'Importing…' : 'Import athletes and generate invites'}
                    </Button>
                  </div>
                </div>
              )}

              {createdAthletes.length ? (
                <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] p-3">
                  <div className="mb-2 text-sm font-medium">Created athletes and invitation links</div>
                  <div className="space-y-2">
                    {createdAthletes.slice(0, 12).map((athlete) => (
                      <div key={athlete.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2">
                        <div className="text-sm font-medium">{athlete.name}</div>
                        <div className="text-xs text-[var(--fg-muted)]">{athlete.email}</div>
                        <div className={cn('mt-1 text-xs', athlete.inviteSent ? 'text-emerald-600' : 'text-amber-700')}>
                          {athlete.inviteSent ? 'Invite email sent' : athlete.inviteError ? `Email failed: ${athlete.inviteError}` : 'Invite pending'}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => navigator.clipboard?.writeText(athlete.inviteLink)}
                          >
                            Copy invite link
                          </Button>
                          <a href={buildInviteMailto(athlete)} className="inline-flex min-h-[36px] items-center rounded-xl border border-[var(--border-subtle)] px-3 text-sm">
                            Open email draft
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {currentStep.key === 'TRAINING_REQUEST' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="text-base font-semibold">Training Request flow</div>
                <p className="mt-2 text-sm text-[var(--fg-muted)]">
                  Athletes complete an event-specific request. You or the athlete can initiate it, and updates sync directly into the plan workflow.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="text-base font-semibold">AI-assisted Plan Builder</div>
                <p className="mt-2 text-sm text-[var(--fg-muted)]">
                  CoachKit builds week structures first, then detailed sessions. You can adjust with AI controls or manual edits before publish.
                </p>
              </div>
              <div className="md:col-span-2">
                <a href="/coach/athletes" className="text-sm font-medium text-blue-600 underline underline-offset-2">
                  Open Athletes to start a Training Request
                </a>
              </div>
            </div>
          ) : null}

          {currentStep.key === 'CALENDAR' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="text-base font-semibold">Scheduling Calendar</div>
                <p className="mt-2 text-sm text-[var(--fg-muted)]">
                  Plan week/month views, copy and paste sessions, publish controls, and clear status signals for draft, scheduled, missed, and completed.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="text-base font-semibold">Group Sessions + Strava + Export</div>
                <p className="mt-2 text-sm text-[var(--fg-muted)]">
                  Build recurring group sessions, sync athlete Strava data, and provide athlete calendar export where needed.
                </p>
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <a href="/coach/calendar" className="text-sm font-medium text-blue-600 underline underline-offset-2">
                  Open Scheduling Calendar
                </a>
                <a href="/coach/group-sessions" className="text-sm font-medium text-blue-600 underline underline-offset-2">
                  Open Group Session Builder
                </a>
              </div>
            </div>
          ) : null}

          {currentStep.key === 'MESSAGING' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="text-base font-semibold">Inbox + Sent workflow</div>
                <p className="mt-2 text-sm text-[var(--fg-muted)]">
                  Send messages to individual athletes, selected athletes, or all squad members from one compose flow.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
                <div className="text-base font-semibold">Actionable communication</div>
                <p className="mt-2 text-sm text-[var(--fg-muted)]">
                  Keep planning feedback in the app, and use notification badges to spot unread updates instantly.
                </p>
              </div>
              <div className="md:col-span-2">
                <a href="/coach/notifications" className="text-sm font-medium text-blue-600 underline underline-offset-2">
                  Open Notifications
                </a>
              </div>
            </div>
          ) : null}

          {success ? <p className="mt-4 text-sm text-emerald-600">{success}</p> : null}
          {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] p-4 md:p-5">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--fg-muted)]">
            <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
            Don&apos;t show again
          </label>

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Skip
            </Button>
            {stepIndex > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setStepIndex((p) => Math.max(0, p - 1))}>
                Back
              </Button>
            ) : null}
            {stepIndex < STEPS.length - 1 ? (
              <Button type="button" variant="primary" onClick={() => void onNext()} disabled={!canGoNext || saving}>
                {saving ? 'Saving…' : 'Next'}
              </Button>
            ) : (
              <Button type="button" variant="primary" onClick={finish}>
                Finish onboarding
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
