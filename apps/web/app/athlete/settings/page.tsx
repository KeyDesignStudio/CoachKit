'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { getTimezoneLabel, TIMEZONE_VALUES } from '@/lib/timezones';

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

type DefaultLocationResponse = {
  defaultLat: number | null;
  defaultLon: number | null;
  defaultLocationLabel: string | null;
};

export default function AthleteSettingsPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const searchParams = useSearchParams();

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

  const [defaultLocationLabel, setDefaultLocationLabel] = useState('');
  const [defaultLat, setDefaultLat] = useState('');
  const [defaultLon, setDefaultLon] = useState('');
  const [savingDefaultLocation, setSavingDefaultLocation] = useState(false);
  const [defaultLocationMessage, setDefaultLocationMessage] = useState('');
  const [defaultLocationError, setDefaultLocationError] = useState('');

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

  useEffect(() => {
    if (user?.role !== 'ATHLETE') return;

    void (async () => {
      try {
        const data = await request<DefaultLocationResponse>('/api/me/default-location');
        setDefaultLocationLabel(data.defaultLocationLabel ?? '');
        setDefaultLat(data.defaultLat == null ? '' : String(data.defaultLat));
        setDefaultLon(data.defaultLon == null ? '' : String(data.defaultLon));
      } catch {
        // If the profile is missing or the endpoint errors, keep UI usable.
      }
    })();
  }, [request, user?.role]);

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

  const handleSaveDefaultLocation = async () => {
    const label = defaultLocationLabel.trim();
    const latRaw = defaultLat.trim();
    const lonRaw = defaultLon.trim();

    setSavingDefaultLocation(true);
    setDefaultLocationMessage('');
    setDefaultLocationError('');

    try {
      let latValue: number | null = null;
      let lonValue: number | null = null;

      if (latRaw || lonRaw) {
        if (!latRaw || !lonRaw) {
          setDefaultLocationError('Latitude and longitude must be provided together.');
          return;
        }

        const latParsed = Number(latRaw);
        const lonParsed = Number(lonRaw);

        if (!Number.isFinite(latParsed) || !Number.isFinite(lonParsed)) {
          setDefaultLocationError('Latitude and longitude must be valid numbers.');
          return;
        }

        latValue = latParsed;
        lonValue = lonParsed;
      }

      const updated = await request<DefaultLocationResponse>('/api/me/default-location', {
        method: 'PATCH',
        data: {
          defaultLat: latValue,
          defaultLon: lonValue,
          defaultLocationLabel: latValue == null ? null : label ? label : null,
        },
      });

      setDefaultLocationLabel(updated.defaultLocationLabel ?? '');
      setDefaultLat(updated.defaultLat == null ? '' : String(updated.defaultLat));
      setDefaultLon(updated.defaultLon == null ? '' : String(updated.defaultLon));
      setDefaultLocationMessage(latValue == null ? 'Default location cleared.' : 'Default location saved.');
    } catch (err) {
      setDefaultLocationError(err instanceof Error ? err.message : 'Failed to save default location.');
    } finally {
      setSavingDefaultLocation(false);
    }
  };

  const handleClearDefaultLocation = async () => {
    setSavingDefaultLocation(true);
    setDefaultLocationMessage('');
    setDefaultLocationError('');

    try {
      const updated = await request<DefaultLocationResponse>('/api/me/default-location', {
        method: 'PATCH',
        data: {
          defaultLat: null,
          defaultLon: null,
          defaultLocationLabel: null,
        },
      });

      setDefaultLocationLabel(updated.defaultLocationLabel ?? '');
      setDefaultLat(updated.defaultLat == null ? '' : String(updated.defaultLat));
      setDefaultLon(updated.defaultLon == null ? '' : String(updated.defaultLon));
      setDefaultLocationMessage('Default location cleared.');
    } catch (err) {
      setDefaultLocationError(err instanceof Error ? err.message : 'Failed to clear default location.');
    } finally {
      setSavingDefaultLocation(false);
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
      <header className="rounded-3xl border border-white/20 bg-white/40 px-4 py-4 md:px-6 md:py-5 backdrop-blur-3xl shadow-inner">
        <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-[var(--muted)]">Settings</p>
        <h1 className="text-2xl md:text-3xl font-semibold">Integrations</h1>
        <p className="text-xs md:text-sm text-[var(--muted)]">Manage connections to external services.</p>
      </header>

      {resultMessage ? (
        <Card className="flex items-center justify-between gap-4">
          <p className="text-sm text-[var(--text)]">{resultMessage}</p>
          <Badge>{searchParams.get('strava') || ''}</Badge>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="min-w-0">
          <Card className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-lg font-semibold">Timezone</h2>
                <p className="text-sm text-[var(--muted)]">Times and day-boundaries (missed) use this timezone.</p>
              </div>
              <Badge className="text-[var(--muted)]">{getTimezoneLabel(timezone)}</Badge>
            </div>

            <TimezoneSelect value={timezone} onChange={handleTimezoneChange} disabled={savingTimezone} />
            {timezoneMessage ? <p className="text-sm text-emerald-700">{timezoneMessage}</p> : null}
            {timezoneError ? <p className="text-sm text-red-700">{timezoneError}</p> : null}
          </Card>
        </div>

        <div className="min-w-0">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Default workout location</h2>
              <p className="text-sm text-[var(--muted)]">Used for weather on workout detail pages. Use decimal degrees.</p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Label (optional)</p>
                <Input value={defaultLocationLabel} onChange={(e) => setDefaultLocationLabel(e.target.value)} placeholder="Gold Coast" disabled={savingDefaultLocation} />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Latitude</p>
                  <Input value={defaultLat} onChange={(e) => setDefaultLat(e.target.value)} placeholder="-27.468" inputMode="decimal" disabled={savingDefaultLocation} />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Longitude</p>
                  <Input value={defaultLon} onChange={(e) => setDefaultLon(e.target.value)} placeholder="153.023" inputMode="decimal" disabled={savingDefaultLocation} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={handleSaveDefaultLocation} disabled={savingDefaultLocation}>
                {savingDefaultLocation ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="secondary" onClick={handleClearDefaultLocation} disabled={savingDefaultLocation}>
                Clear
              </Button>
            </div>

            {defaultLocationMessage ? <p className="text-sm text-emerald-700">{defaultLocationMessage}</p> : null}
            {defaultLocationError ? <p className="text-sm text-red-700">{defaultLocationError}</p> : null}
          </Card>
        </div>

        <div className="min-w-0">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold">Strava</h2>
                  <Badge className={connected ? 'text-emerald-700' : 'text-[var(--muted)]'}>{connected ? 'Connected' : 'Not connected'}</Badge>
                </div>
                <p className="text-sm text-[var(--muted)]">Connect Strava to sync completed activities into CoachKit.</p>
              </div>

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
              <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/60 p-4 text-sm text-emerald-900">
                <p className="font-medium">Strava sync complete</p>
                <p className="text-emerald-900/80">{new Date(lastSync.at).toLocaleString()}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-emerald-900/90">
                  <p>Fetched: <span className="font-medium">{lastSync.summary.fetched}</span></p>
                  <p>Matched: <span className="font-medium">{lastSync.summary.matched}</span></p>
                  <p>Created: <span className="font-medium">{lastSync.summary.created}</span></p>
                  <p>Updated: <span className="font-medium">{lastSync.summary.updated}</span></p>
                  <p>Skipped: <span className="font-medium">{lastSync.summary.skippedExisting}</span></p>
                  <p>Errors: <span className="font-medium">{lastSync.summary.errors.length}</span></p>
                </div>
                {lastSync.summary.errors.length ? (
                  <div className="mt-3 rounded-xl border border-red-200/60 bg-white/50 p-3 text-sm text-red-800">
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
              <div className="rounded-2xl border border-white/25 bg-white/30 p-4 text-sm text-[var(--muted)]">
                <p>Strava athlete ID: <span className="text-[var(--text)]">{status.connection.stravaAthleteId}</span></p>
                {status.connection.scope ? <p>Scope: <span className="text-[var(--text)]">{status.connection.scope}</span></p> : null}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </section>
  );
}
