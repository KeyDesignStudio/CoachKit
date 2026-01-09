'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

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

export default function AthleteSettingsPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<StravaStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

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
        <p className="text-xs md:text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Settings</p>
        <h1 className="text-2xl md:text-3xl font-semibold">Integrations</h1>
        <p className="text-xs md:text-sm text-[var(--muted)]">Manage connections to external services.</p>
      </header>

      {resultMessage ? (
        <Card className="flex items-center justify-between gap-4">
          <p className="text-sm text-[var(--text)]">{resultMessage}</p>
          <Badge>{searchParams.get('strava') || ''}</Badge>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Strava</h2>
              <Badge className={connected ? 'text-emerald-700' : 'text-[var(--muted)]'}>{connected ? 'Connected' : 'Not connected'}</Badge>
            </div>
            <p className="text-sm text-[var(--muted)]">Connect Strava to sync completed activities into CoachKit.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            {connected ? (
              <Button variant="secondary" onClick={handleDisconnect} disabled={working}>
                {working ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            ) : (
              <Button onClick={handleConnect} disabled={working}>
                Connect
              </Button>
            )}
          </div>
        </div>

        {loadingStatus ? <p className="text-sm text-[var(--muted)]">Loading status…</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        {connected && status?.connection ? (
          <div className="rounded-2xl border border-white/25 bg-white/30 p-4 text-sm text-[var(--muted)]">
            <p>Strava athlete ID: <span className="text-[var(--text)]">{status.connection.stravaAthleteId}</span></p>
            {status.connection.scope ? <p>Scope: <span className="text-[var(--text)]">{status.connection.scope}</span></p> : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
