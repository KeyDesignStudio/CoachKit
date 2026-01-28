'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Block } from '@/components/ui/Block';
import { SelectField } from '@/components/ui/SelectField';
import { Input } from '@/components/ui/Input';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { getTimezoneLabel, TIMEZONE_VALUES } from '@/lib/timezones';
import { WeatherLocationSelect } from '@/components/WeatherLocationSelect';
import { useThemePreference } from '@/components/theme-preference';

type StravaStatusResponse = {
  connected: boolean;
  connection: {
    stravaAthleteId: string;
    expiresAt: string;
    scope: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

type PollSummary = {
  polledAthletes: number;
  fetched: number;
  created: number;
  updated: number;
  matched: number;
  skippedExisting: number;
  errors: Array<{ athleteId?: string; message: string }>;
};

export default function AthleteSettingsPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const searchParams = useSearchParams();

  const { preference: themePreference, setThemePreference } = useThemePreference();

  const [status, setStatus] = useState<StravaStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [working, setWorking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ at: string; summary: PollSummary } | null>(null);
  const [error, setError] = useState('');

  const [timezone, setTimezone] = useState('Australia/Brisbane');
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [timezoneMessage, setTimezoneMessage] = useState('');
  const [timezoneError, setTimezoneError] = useState('');

  const [icalUrl, setIcalUrl] = useState<string>('');
  const [loadingIcal, setLoadingIcal] = useState(false);
  const [resettingIcal, setResettingIcal] = useState(false);
  const [icalMessage, setIcalMessage] = useState('');
  const [icalError, setIcalError] = useState('');

  useEffect(() => {
    const raw = user?.timezone?.trim() ?? '';
    if (raw) {
      setTimezone(raw);
      return;
    }

    // Only guess from browser if user.timezone is empty.
    const guessed = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimezone(TIMEZONE_VALUES.has(guessed) ? guessed : 'Australia/Brisbane');
  }, [user?.timezone]);

  const resultMessage = useMemo(() => {
    const result = searchParams.get('strava');

    if (!result) return '';

    if (result === 'connected') return 'Strava connected.';
    if (result === 'cancelled') return 'Strava connection cancelled.';
    if (result === 'expired_state') return 'Strava connection expired. Please try again.';
    if (result === 'invalid_state' || result === 'missing_state') return 'Strava connection could not be verified. Please try again.';
    if (result === 'missing_code') return 'Strava did not return a code. Please try again.';

    return 'Strava connection failed. Please try again.';
  }, [searchParams]);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setError('');

    try {
      const data = await request<StravaStatusResponse>('/api/integrations/strava/status');
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integration status.');
    } finally {
      setLoadingStatus(false);
    }
  }, [request]);

  useEffect(() => {
    if (user?.role !== 'ATHLETE') return;
    void loadStatus();
  }, [user?.role, loadStatus]);

  const loadIcalLink = useCallback(async () => {
    setLoadingIcal(true);
    setIcalError('');
    setIcalMessage('');

    try {
      const data = await request<{ url: string }>('/api/athlete/ical-link', { cache: 'no-store' });
      setIcalUrl(data.url);
    } catch (err) {
      setIcalError(err instanceof Error ? err.message : 'Failed to load calendar sync link.');
    } finally {
      setLoadingIcal(false);
    }
  }, [request]);

  useEffect(() => {
    if (user?.role !== 'ATHLETE') return;
    void loadIcalLink();
  }, [loadIcalLink, user?.role]);

  const copyIcalLink = useCallback(async () => {
    setIcalMessage('');
    setIcalError('');

    if (!icalUrl) return;
    try {
      await navigator.clipboard.writeText(icalUrl);
      setIcalMessage('Subscribe link copied.');
    } catch {
      // Fallback.
      window.prompt('Copy this link:', icalUrl);
    }
  }, [icalUrl]);

  const resetIcalLink = useCallback(async () => {
    setResettingIcal(true);
    setIcalError('');
    setIcalMessage('');

    try {
      const data = await request<{ url: string }>('/api/athlete/ical-link/reset', {
        method: 'POST',
      });
      setIcalUrl(data.url);
      setIcalMessage('Subscribe link reset. You will need to re-subscribe in your calendar app.');
    } catch (err) {
      setIcalError(err instanceof Error ? err.message : 'Failed to reset calendar sync link.');
    } finally {
      setResettingIcal(false);
    }
  }, [request]);

  const handleConnect = () => {
    window.location.href = '/api/integrations/strava/connect?redirectTo=/athlete/settings';
  };

  const handleDisconnect = async () => {
    setWorking(true);
    setError('');

    try {
      await request<{ disconnected: boolean }>('/api/integrations/strava/disconnect', { method: 'POST' });
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect Strava.');
    } finally {
      setWorking(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setError('');
    setLastSync(null);

    try {
      const summary = await request<PollSummary>('/api/integrations/strava/poll?forceDays=14', { method: 'POST' });
      setLastSync({ at: new Date().toISOString(), summary });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync Strava.');
    } finally {
      setSyncing(false);
    }
  };

  const handleTimezoneChange = async (nextTz: string) => {
    const previous = timezone;
    setTimezone(nextTz);
    setSavingTimezone(true);
    setTimezoneMessage('');
    setTimezoneError('');

    try {
      await request<{ user: { id: string; timezone: string } }>('/api/me/timezone', {
        method: 'PATCH',
        data: { timezone: nextTz },
      });
      setTimezoneMessage('Timezone updated.');
    } catch (err) {
      setTimezone(previous);
      setTimezoneError(err instanceof Error ? err.message : 'Failed to update timezone.');
    } finally {
      setSavingTimezone(false);
    }
  };

  if (userLoading) {
    return <p className="text-[var(--muted)]">Loading...</p>;
  }

  if (!user || user.role !== 'ATHLETE') {
    return <p className="text-[var(--muted)]">Athlete access required.</p>;
  }

  const connected = Boolean(status?.connected);

  return (
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 md:px-6 md:py-5 shadow-inner">
        <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-[var(--muted)]">Settings</p>
        <h1 className="text-2xl md:text-3xl font-semibold">Integrations</h1>
        <p className="text-xs md:text-sm text-[var(--muted)]">Manage connections to external services.</p>
      </header>

      {resultMessage ? (
        <Block>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-[var(--text)]">{resultMessage}</p>
            <Badge>{searchParams.get('strava') || ''}</Badge>
          </div>
        </Block>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0">
          <Block
            title="Timezone"
            rightAction={<Badge className="text-[var(--muted)]">{getTimezoneLabel(timezone)}</Badge>}
          >
            <p className="text-sm text-[var(--muted)] mb-3">Times and day-boundaries (missed) use this timezone.</p>
            <TimezoneSelect value={timezone} onChange={handleTimezoneChange} disabled={savingTimezone} />
            {timezoneMessage ? <p className="text-sm text-[var(--text-success)] mt-2">{timezoneMessage}</p> : null}
            {timezoneError ? <p className="text-sm text-rose-700 dark:text-rose-300 mt-2">{timezoneError}</p> : null}
          </Block>
        </div>

        <div className="min-w-0">
          <Block
            title="Appearance"
            rightAction={
              <Badge className="text-[var(--muted)]">
                {themePreference === 'system' ? 'System' : themePreference === 'dark' ? 'Dark' : 'Light'}
              </Badge>
            }
          >
            <p className="text-sm text-[var(--muted)] mb-3">Choose light, dark, or follow your system setting.</p>

            <SelectField
              value={themePreference}
              onChange={(e) => setThemePreference(e.target.value as any)}
              aria-label="Theme"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </SelectField>
          </Block>
        </div>

        <div className="min-w-0">
          <Block title="Weather location">
            <p className="text-sm text-[var(--muted)] mb-3">Used for weather. Search by place name or use your current location.</p>
            <WeatherLocationSelect />
          </Block>
        </div>

        <div className="min-w-0">
          <Block title="Calendar Sync">
            <p className="text-sm text-[var(--muted)] mb-3">
              Subscribe to your CoachKit workouts via a private iCal link (read-only). If you share the link, anyone with it can view your calendar.
            </p>

            {loadingIcal ? <p className="text-sm text-[var(--muted)]">Loading calendar sync link…</p> : null}
            {icalError ? <p className="text-sm text-red-700">{icalError}</p> : null}

            <div className="flex flex-col gap-3">
              <Input
                value={icalUrl}
                readOnly
                placeholder="Calendar sync link will appear here"
                className="font-mono text-xs"
              />

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void copyIcalLink()} disabled={!icalUrl || loadingIcal}>
                  Copy link
                </Button>
                <Button variant="secondary" onClick={() => void resetIcalLink()} disabled={resettingIcal || loadingIcal}>
                  {resettingIcal ? 'Resetting…' : 'Reset link'}
                </Button>
              </div>

              {icalMessage ? <p className="text-sm text-[var(--text-success)]">{icalMessage}</p> : null}
            </div>
          </Block>
        </div>

        <div className="min-w-0">
          <Block
            title="Strava"
            rightAction={<Badge className={connected ? 'text-emerald-700' : 'text-[var(--muted)]'}>{connected ? 'Connected' : 'Not connected'}</Badge>}
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <p className="text-sm text-[var(--muted)]">Connect Strava to sync completed activities into CoachKit.</p>

                <div className="flex flex-wrap gap-3">
                  {connected ? (
                    <>
                      <Button onClick={handleSyncNow} disabled={working || syncing || loadingStatus}>
                        {syncing ? 'Syncing…' : 'Sync now'}
                      </Button>
                      <Button variant="secondary" onClick={handleDisconnect} disabled={working || syncing}>
                        {working ? 'Disconnecting…' : 'Disconnect'}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={handleConnect} disabled={working}>
                      Connect
                    </Button>
                  )}
                </div>
              </div>

              {loadingStatus ? <p className="text-sm text-[var(--muted)]">Loading status…</p> : null}
              {error ? <p className="text-sm text-red-700">{error}</p> : null}

              {lastSync ? (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-success)] p-4 text-sm text-[var(--text-success)]">
                  <p className="font-medium">Strava sync complete</p>
                  <p className="opacity-80">{new Date(lastSync.at).toLocaleString()}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <p>Fetched: <span className="font-medium">{lastSync.summary.fetched}</span></p>
                    <p>Matched: <span className="font-medium">{lastSync.summary.matched}</span></p>
                    <p>Created: <span className="font-medium">{lastSync.summary.created}</span></p>
                    <p>Updated: <span className="font-medium">{lastSync.summary.updated}</span></p>
                    <p>Skipped: <span className="font-medium">{lastSync.summary.skippedExisting}</span></p>
                    <p>Errors: <span className="font-medium">{lastSync.summary.errors.length}</span></p>
                  </div>
                  {lastSync.summary.errors.length ? (
                    <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm text-rose-700 dark:text-rose-300">
                      <p className="font-medium">Some activities failed to sync</p>
                      <ul className="mt-2 list-disc pl-5">
                        {lastSync.summary.errors.slice(0, 3).map((e, idx) => (
                          <li key={idx}>{e.message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {connected && status?.connection ? (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--muted)]">
                  <p>Strava athlete ID: <span className="text-[var(--text)]">{status.connection.stravaAthleteId}</span></p>
                  {status.connection.scope ? <p>Scope: <span className="text-[var(--text)]">{status.connection.scope}</span></p> : null}
                </div>
              ) : null}
            </div>
          </Block>
        </div>
      </div>
    </section>
  );
}
