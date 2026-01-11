'use client';

import { FormEvent, useEffect, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { useBranding } from '@/components/branding-context';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { getTimezoneLabel, TIMEZONE_VALUES } from '@/lib/timezones';

export default function CoachSettingsPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const { branding, loading: brandingLoading, error: brandingError, refresh: refreshBranding } = useBranding();
  const [form, setForm] = useState({
    displayName: DEFAULT_BRAND_NAME,
    logoUrl: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [timezone, setTimezone] = useState('Australia/Brisbane');
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [timezoneMessage, setTimezoneMessage] = useState('');
  const [timezoneError, setTimezoneError] = useState('');

  useEffect(() => {
    setForm({
      displayName: branding.displayName || DEFAULT_BRAND_NAME,
      logoUrl: branding.logoUrl ?? '',
    });
  }, [branding.displayName, branding.logoUrl]);

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

  const uploadLogo = async (file: File) => {
    if (!user?.userId) {
      throw new Error('User not authenticated.');
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/coach/branding/logo', {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Logo upload failed.');
    }

    return (payload.data?.url ?? '') as string;
  };

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setUploading(true);
    setError('');

    try {
      const url = await uploadLogo(file);
      setForm((prev) => ({ ...prev, logoUrl: url }));
      setMessage('Logo uploaded. Remember to save changes.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (user?.role !== 'COACH') {
      setError('Coach access required.');
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');

    try {
      await request('/api/coach/branding', {
        method: 'PATCH',
        data: {
          displayName: form.displayName.trim(),
          logoUrl: form.logoUrl || null,
        },
      });

      await refreshBranding();
      setMessage('Branding updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update branding.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setMessage('');
    setError('');
    setForm({
      displayName: branding.displayName || DEFAULT_BRAND_NAME,
      logoUrl: branding.logoUrl ?? '',
    });
    await refreshBranding();
  };

  if (userLoading) {
    return <p style={{ padding: '2rem' }}>Loading...</p>;
  }

  if (!user || user.role !== 'COACH') {
    return <p style={{ padding: '2rem' }}>Coach access required.</p>;
  }

  return (
    <section style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header>
        <h1 style={{ margin: 0 }}>Coach Branding</h1>
        <p style={{ color: '#475569', margin: '0.25rem 0 0' }}>Update the logo and name athletes will see across CoachKit.</p>
      </header>
      {brandingLoading ? <p>Loading current branding…</p> : null}
      {error || brandingError ? <p style={{ color: '#b91c1c' }}>{error || brandingError}</p> : null}
      {message ? <p style={{ color: '#047857' }}>{message}</p> : null}
      <form onSubmit={handleSubmit} style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '0.75rem', border: '1px solid #e2e8f0', maxWidth: 520 }}>
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          Display name
          <input
            type="text"
            value={form.displayName}
            onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
            style={{ display: 'block', marginTop: '0.25rem', width: '100%' }}
            required
          />
        </label>
        <label style={{ display: 'block', marginBottom: '1rem' }}>
          Logo image
          <input type="file" accept="image/*" onChange={handleLogoChange} disabled={uploading} style={{ display: 'block', marginTop: '0.25rem' }} />
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.25rem 0 0' }}>Upload a small square image (PNG/JPG).</p>
        </label>
        {form.logoUrl ? (
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={form.logoUrl} alt="Current logo" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }} />
            <button type="button" onClick={() => setForm((prev) => ({ ...prev, logoUrl: '' }))} disabled={uploading}>
              Remove logo
            </button>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save branding'}
          </button>
          <button type="button" onClick={handleReset} disabled={brandingLoading || saving}>
            Reset
          </button>
        </div>
      </form>

      <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '0.75rem', border: '1px solid #e2e8f0', maxWidth: 520 }}>
        <h2 style={{ margin: 0 }}>Timezone</h2>
        <p style={{ color: '#475569', margin: '0.25rem 0 1rem' }}>Times and day-boundaries use your timezone.</p>
        <p style={{ color: '#64748b', margin: '0 0 0.75rem' }}>Current: <span style={{ color: '#0f172a', fontWeight: 500 }}>{getTimezoneLabel(timezone)}</span></p>
        <TimezoneSelect value={timezone} onChange={handleTimezoneChange} disabled={savingTimezone} />
        {timezoneMessage ? <p style={{ color: '#047857', margin: '0.75rem 0 0' }}>{timezoneMessage}</p> : null}
        {timezoneError ? <p style={{ color: '#b91c1c', margin: '0.75rem 0 0' }}>{timezoneError}</p> : null}
      </div>
    </section>
  );
}
