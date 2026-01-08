'use client';

import { FormEvent, useEffect, useState } from 'react';

import { useApi } from '@/components/api-client';
import { useUser } from '@/components/user-context';
import { useBranding } from '@/components/branding-context';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';

export default function CoachSettingsPage() {
  const { user } = useUser();
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

  useEffect(() => {
    setForm({
      displayName: branding.displayName || DEFAULT_BRAND_NAME,
      logoUrl: branding.logoUrl ?? '',
    });
  }, [branding.displayName, branding.logoUrl]);

  const uploadLogo = async (file: File) => {
    if (!user.userId) {
      throw new Error('Set an active user before uploading.');
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/coach/branding/logo', {
      method: 'POST',
      body: formData,
      headers: {
        'x-user-id': user.userId,
      },
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

    if (user.role !== 'COACH') {
      setError('Switch to a coach identity to edit branding.');
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

  if (user.role !== 'COACH') {
    return <p style={{ padding: '2rem' }}>Switch to a coach identity to manage branding.</p>;
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
    </section>
  );
}
