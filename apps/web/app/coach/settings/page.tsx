'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { useBranding } from '@/components/branding-context';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { getTimezoneLabel, TIMEZONE_VALUES } from '@/lib/timezones';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

function filenameFromUrl(url: string | null | undefined): string | null {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return null;

  const withoutHash = raw.split('#')[0] ?? raw;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;

  try {
    const parsed = new URL(withoutQuery, 'http://local');
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return 'Uploaded';
    const decoded = decodeURIComponent(last);
    return decoded || 'Uploaded';
  } catch {
    const last = withoutQuery.split('/').filter(Boolean).pop();
    if (!last) return 'Uploaded';
    try {
      return decodeURIComponent(last) || 'Uploaded';
    } catch {
      return last || 'Uploaded';
    }
  }
}

function useAutoClearSaved(setState: (next: SaveState) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSaved = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setState({ kind: 'saved' });
    timerRef.current = setTimeout(() => {
      setState({ kind: 'idle' });
      timerRef.current = null;
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { setSaved };
}

export default function CoachSettingsPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const { branding, loading: brandingLoading, error: brandingError, refresh: refreshBranding } = useBranding();
  const showDevBrandingSampleButton =
    process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_SHOW_DEV_PAGES === 'true';

  const [displayName, setDisplayName] = useState(DEFAULT_BRAND_NAME);
  const [nameSave, setNameSave] = useState<SaveState>({ kind: 'idle' });
  const [lightSave, setLightSave] = useState<SaveState>({ kind: 'idle' });
  const [darkSave, setDarkSave] = useState<SaveState>({ kind: 'idle' });
  const { setSaved: setNameSaved } = useAutoClearSaved(setNameSave);
  const { setSaved: setLightSaved } = useAutoClearSaved(setLightSave);
  const { setSaved: setDarkSaved } = useAutoClearSaved(setDarkSave);

  const lightInputRef = useRef<HTMLInputElement | null>(null);
  const darkInputRef = useRef<HTMLInputElement | null>(null);
  const pendingLightFileRef = useRef<File | null>(null);
  const pendingDarkFileRef = useRef<File | null>(null);
  const lastLightActionRef = useRef<'upload' | 'remove' | null>(null);
  const lastDarkActionRef = useRef<'upload' | 'remove' | null>(null);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [timezone, setTimezone] = useState('Australia/Brisbane');
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [timezoneMessage, setTimezoneMessage] = useState('');
  const [timezoneError, setTimezoneError] = useState('');

  useEffect(() => {
    setDisplayName(branding.displayName || DEFAULT_BRAND_NAME);
  }, [branding.displayName]);

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

  const uploadLogo = async (file: File, variant: 'light' | 'dark') => {
    if (!user?.userId) {
      throw new Error('User not authenticated.');
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`/api/coach/branding/logo?variant=${variant}`, {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Logo upload failed.');
    }

    return (payload.data?.url ?? '') as string;
  };

  const removeLogo = async (variant: 'light' | 'dark') => {
    const response = await fetch(`/api/coach/branding/logo?variant=${variant}`, { method: 'DELETE' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Failed to remove logo.');
    }
  };

  const uploadOrReplace = async (variant: 'light' | 'dark', file: File) => {
    if (variant === 'light') {
      pendingLightFileRef.current = file;
      lastLightActionRef.current = 'upload';
      setLightSave({ kind: 'saving' });
    } else {
      pendingDarkFileRef.current = file;
      lastDarkActionRef.current = 'upload';
      setDarkSave({ kind: 'saving' });
    }

    try {
      await uploadLogo(file, variant);
      await refreshBranding();
      router.refresh();
      if (variant === 'light') {
        pendingLightFileRef.current = null;
        setLightSaved();
      } else {
        pendingDarkFileRef.current = null;
        setDarkSaved();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      if (variant === 'light') {
        setLightSave({ kind: 'error', message });
      } else {
        setDarkSave({ kind: 'error', message });
      }
    }
  };

  const handleLightFilePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadOrReplace('light', file);
  };

  const handleDarkFilePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadOrReplace('dark', file);
  };

  const handleRemove = async (variant: 'light' | 'dark') => {
    if (variant === 'light') {
      lastLightActionRef.current = 'remove';
      setLightSave({ kind: 'saving' });
    } else {
      lastDarkActionRef.current = 'remove';
      setDarkSave({ kind: 'saving' });
    }

    try {
      await removeLogo(variant);
      await refreshBranding();
      router.refresh();
      if (variant === 'light') {
        setLightSaved();
      } else {
        setDarkSaved();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      if (variant === 'light') {
        setLightSave({ kind: 'error', message });
      } else {
        setDarkSave({ kind: 'error', message });
      }
    }
  };

  const handleUseSampleLogo = async () => {
    setLightSave({ kind: 'saving' });
    setDarkSave({ kind: 'saving' });

    try {
      await request('/api/coach/branding', {
        method: 'PATCH',
        data: {
          logoUrl: '/_dev/msg-logo.jpeg',
          darkLogoUrl: '/brand/MSG_DarkLogo.png',
        },
      });
      await refreshBranding();
      router.refresh();
      setLightSaved();
      setDarkSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setLightSave({ kind: 'error', message });
      setDarkSave({ kind: 'error', message });
    }
  };

  const lightFilename = useMemo(() => filenameFromUrl(branding.logoUrl), [branding.logoUrl]);
  const darkFilename = useMemo(() => filenameFromUrl(branding.darkLogoUrl), [branding.darkLogoUrl]);

  const displayNameDirty = (displayName || '').trim() !== (branding.displayName || '').trim();

  const saveDisplayName = async (nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) {
      setNameSave({ kind: 'error', message: 'Display name is required.' });
      return;
    }

    setNameSave({ kind: 'saving' });
    try {
      await request('/api/coach/branding', {
        method: 'PATCH',
        data: { displayName: trimmed },
      });
      await refreshBranding();
      router.refresh();
      setNameSaved();
    } catch (err) {
      setNameSave({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };

  useEffect(() => {
    if (!displayNameDirty) {
      if (nameDebounceRef.current) {
        clearTimeout(nameDebounceRef.current);
        nameDebounceRef.current = null;
      }
      return;
    }

    if (nameDebounceRef.current) {
      clearTimeout(nameDebounceRef.current);
    }

    nameDebounceRef.current = setTimeout(() => {
      void saveDisplayName(displayName);
    }, 600);

    return () => {
      if (nameDebounceRef.current) {
        clearTimeout(nameDebounceRef.current);
        nameDebounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayNameDirty, displayName]);

  const openPicker = (variant: 'light' | 'dark') => {
    const input = variant === 'light' ? lightInputRef.current : darkInputRef.current;
    if (!input) return;
    // Allow selecting the same file again.
    input.value = '';
    input.click();
  };

  const retryVariant = (variant: 'light' | 'dark') => {
    const lastAction = variant === 'light' ? lastLightActionRef.current : lastDarkActionRef.current;
    if (lastAction === 'remove') {
      void handleRemove(variant);
      return;
    }

    const file = variant === 'light' ? pendingLightFileRef.current : pendingDarkFileRef.current;
    if (file) {
      void uploadOrReplace(variant, file);
      return;
    }

    openPicker(variant);
  };

  function LogoRow({
    label,
    filename,
    variant,
    saveState,
  }: {
    label: string;
    filename: string | null;
    variant: 'light' | 'dark';
    saveState: SaveState;
  }) {
    const hasFile = Boolean(filename);
    const isSaving = saveState.kind === 'saving';

    return (
      <div>
        <div className="text-sm font-medium text-[var(--text)]">{label}</div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 max-w-full truncate text-sm text-[var(--text)]" title={filename || 'No file uploaded'}>
            {filename || 'No file uploaded'}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
            <button
              type="button"
              onClick={() => openPicker(variant)}
              disabled={isSaving}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : hasFile ? 'Replace' : 'Upload'}
            </button>

            {hasFile ? (
              <button
                type="button"
                onClick={() => void handleRemove(variant)}
                disabled={isSaving}
                aria-label={variant === 'light' ? 'Remove logo' : 'Remove dark logo'}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] text-red-600 hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-60"
              >
                <Icon
                  name={isSaving ? 'refresh' : 'delete'}
                  size="md"
                  className={isSaving ? 'animate-spin' : ''}
                  aria-hidden
                />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-1 text-xs text-[var(--muted)]">Recommended: 512×512 PNG/JPG (square, under 200 KB)</div>

        <div className="mt-1 text-xs">
          {saveState.kind === 'saving' ? <span className="text-[var(--muted)]">Saving…</span> : null}
          {saveState.kind === 'saved' ? <span className="text-emerald-600">Saved</span> : null}
          {saveState.kind === 'idle' && hasFile ? <span className="text-[var(--muted)]">Uploaded</span> : null}
          {saveState.kind === 'error' ? (
            <div className="flex items-center gap-2">
              <span className="text-red-600">Something went wrong</span>
              <button
                type="button"
                onClick={() => retryVariant(variant)}
                className="text-xs font-medium text-[var(--text)] underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (userLoading) {
    return <p style={{ padding: '2rem' }}>Loading...</p>;
  }

  if (!user || user.role !== 'COACH') {
    return <p style={{ padding: '2rem' }}>Coach access required.</p>;
  }

  return (
    <section className="px-4 py-6 md:px-6 flex flex-col gap-6">
      <header>
        <h1 className="m-0 text-lg font-semibold text-[var(--text)]">Coach Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Manage program branding and timezone.</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="w-full">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="m-0 text-base font-semibold text-[var(--text)]">Branding</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Update the logo and name athletes will see across CoachKit.</p>
            </div>
            {brandingLoading ? <span className="text-xs text-[var(--muted)]">Loading…</span> : null}
          </div>

          {brandingError ? <p className="mt-3 text-sm text-red-600">{brandingError}</p> : null}

          {/* Display name (autosave) */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-[var(--text)]" htmlFor="coach-branding-display-name">
              Display name
            </label>
            <div className="mt-2 flex items-start gap-3">
              <input
                id="coach-branding-display-name"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                onBlur={() => void saveDisplayName(displayName)}
                className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
                required
              />
            </div>
            <div className="mt-1 text-xs">
              {nameSave.kind === 'saving' ? <span className="text-[var(--muted)]">Saving…</span> : null}
              {nameSave.kind === 'saved' ? <span className="text-emerald-600">Saved</span> : null}
              {nameSave.kind === 'error' ? (
                <div className="flex items-center gap-2">
                  <span className="text-red-600">Something went wrong</span>
                  <button
                    type="button"
                    onClick={() => void saveDisplayName(displayName)}
                    className="text-xs font-medium text-[var(--text)] underline underline-offset-2"
                  >
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Hidden file inputs (no native 'no file chosen') */}
          <input ref={lightInputRef} type="file" accept="image/*" className="sr-only" onChange={handleLightFilePicked} />
          <input ref={darkInputRef} type="file" accept="image/*" className="sr-only" onChange={handleDarkFilePicked} />

          {/* Logo rows */}
          <div className="mt-5 flex flex-col gap-4">
            <LogoRow label="Logo image" filename={lightFilename} variant="light" saveState={lightSave} />
            <LogoRow label="Dark mode logo image" filename={darkFilename} variant="dark" saveState={darkSave} />
          </div>

          {showDevBrandingSampleButton ? (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => void handleUseSampleLogo()}
                disabled={lightSave.kind === 'saving' || darkSave.kind === 'saving'}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-structure)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-60"
              >
                Use sample club logo (dev)
              </button>
            </div>
          ) : null}
        </Card>

        <Card className="w-full">
          <h2 className="m-0 text-base font-semibold text-[var(--text)]">Timezone</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Times and day-boundaries use your timezone.</p>
          <p className="mt-3 text-sm text-[var(--muted)]">
            Current: <span className="text-[var(--text)] font-medium">{getTimezoneLabel(timezone)}</span>
          </p>
          <div className="mt-3">
            <TimezoneSelect value={timezone} onChange={handleTimezoneChange} disabled={savingTimezone} />
          </div>
          {timezoneMessage ? <p className="mt-3 text-sm text-emerald-600">{timezoneMessage}</p> : null}
          {timezoneError ? <p className="mt-3 text-sm text-red-600">{timezoneError}</p> : null}
        </Card>
      </div>
    </section>
  );
}
