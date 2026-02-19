'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { useBranding } from '@/components/branding-context';
import { DEFAULT_BRAND_NAME } from '@/lib/branding';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { getTimezoneLabel, TIMEZONE_VALUES } from '@/lib/timezones';
import { Block } from '@/components/ui/Block';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { SelectField } from '@/components/ui/SelectField';
import { BlockTitle } from '@/components/ui/BlockTitle';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { Input } from '@/components/ui/Input';
import { useThemePreference } from '@/components/theme-preference';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

type CoachPlanSource = {
  id: string;
  title: string;
  sport: string;
  distance: string;
  level: string;
  durationWeeks: number;
  isActive: boolean;
  createdAt: string;
  latestVersion?: { version: number; extractionMetaJson?: any } | null;
};

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

  const { preference: themePreference, setThemePreference } = useThemePreference();
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
  const [planSources, setPlanSources] = useState<CoachPlanSource[]>([]);
  const [planLibraryBusy, setPlanLibraryBusy] = useState(false);
  const [planLibraryMessage, setPlanLibraryMessage] = useState('');
  const [planLibraryError, setPlanLibraryError] = useState('');
  const [planUpload, setPlanUpload] = useState<{
    title: string;
    sport: string;
    distance: string;
    level: string;
    durationWeeks: string;
    file: File | null;
  }>({
    title: '',
    sport: 'TRIATHLON',
    distance: 'OTHER',
    level: 'BEGINNER',
    durationWeeks: '12',
    file: null,
  });

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

  const fetchPlanSources = async () => {
    const data = await request<{ sources: CoachPlanSource[] }>('/api/coach/plan-library/sources');
    const rows = Array.isArray(data.sources) ? data.sources : [];
    setPlanSources(rows);
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

  useEffect(() => {
    void fetchPlanSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadPlanSource = async () => {
    if (!planUpload.file) {
      setPlanLibraryError('Choose a PDF file first.');
      return;
    }

    setPlanLibraryBusy(true);
    setPlanLibraryMessage('');
    setPlanLibraryError('');
    try {
      const form = new FormData();
      form.set('type', 'PDF');
      form.set('title', planUpload.title.trim() || planUpload.file.name.replace(/\.pdf$/i, ''));
      form.set('sport', planUpload.sport);
      form.set('distance', planUpload.distance);
      form.set('level', planUpload.level);
      form.set('durationWeeks', planUpload.durationWeeks.trim() || '12');
      form.set('file', planUpload.file);

      const response = await fetch('/api/coach/plan-library/ingest', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message || 'Failed to upload plan source.');
      }
      await fetchPlanSources();
      setPlanUpload((prev) => ({ ...prev, title: '', file: null }));
      setPlanLibraryMessage('Plan uploaded to coach library.');
    } catch (err) {
      setPlanLibraryError(err instanceof Error ? err.message : 'Failed to upload plan source.');
    } finally {
      setPlanLibraryBusy(false);
    }
  };

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
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 max-w-full truncate text-sm text-[var(--text)]" title={filename || 'No file uploaded'}>
            {filename || 'No file uploaded'}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
            <Button
              type="button"
              onClick={() => openPicker(variant)}
              disabled={isSaving}
              variant="secondary"
              size="sm"
            >
              {isSaving ? 'Saving…' : hasFile ? 'Replace' : 'Upload'}
            </Button>

            {hasFile ? (
              <Button
                type="button"
                onClick={() => void handleRemove(variant)}
                disabled={isSaving}
                aria-label={variant === 'light' ? 'Remove logo' : 'Remove dark logo'}
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <Icon
                  name={isSaving ? 'refresh' : 'delete'}
                  size="md"
                  className={isSaving ? 'animate-spin' : ''}
                  aria-hidden
                />
              </Button>
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
    <section className="flex flex-col gap-6">
      <Block>
        <h1 className="text-2xl md:text-3xl font-semibold mb-1">Coach Settings</h1>
        <p className="text-sm text-[var(--muted)]">Manage program branding and timezone.</p>
      </Block>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Block className="w-full">
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <BlockTitle>Branding</BlockTitle>
              <p className="mt-1 text-sm text-[var(--muted)]">Update the logo and name athletes will see across CoachKit.</p>
            </div>
            {brandingLoading ? <span className="text-xs text-[var(--muted)]">Loading…</span> : null}
          </div>

          {brandingError ? <p className="mb-4 text-sm text-red-600">{brandingError}</p> : null}

          {/* Display name (autosave) */}
          <div className="mb-6">
            <FieldLabel htmlFor="coach-branding-display-name">Display name</FieldLabel>
            <div className="mt-2">
              <Input
                id="coach-branding-display-name"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                onBlur={() => void saveDisplayName(displayName)}
                required
              />
            </div>
            <div className="mt-1 text-xs h-4">
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
          <div className="flex flex-col gap-6">
            <LogoRow label="Logo image" filename={lightFilename} variant="light" saveState={lightSave} />
            <LogoRow label="Dark mode logo image" filename={darkFilename} variant="dark" saveState={darkSave} />
          </div>

          {showDevBrandingSampleButton ? (
            <div className="mt-6 pt-6 border-t border-[var(--border-subtle)]">
              <Button
                type="button"
                onClick={() => void handleUseSampleLogo()}
                disabled={lightSave.kind === 'saving' || darkSave.kind === 'saving'}
                variant="secondary"
                size="sm"
              >
                Use sample club logo (dev)
              </Button>
            </div>
          ) : null}
        </Block>

        <div className="flex flex-col gap-6">
          <Block className="w-full">
            <BlockTitle>Plan Library</BlockTitle>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Upload your historical plans here. They are available for your use and can inform CoachKit AI globally.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                value={planUpload.title}
                onChange={(e) => setPlanUpload((s) => ({ ...s, title: e.target.value }))}
                placeholder="Plan title (e.g. 12wk Olympic Beginner)"
              />
              <Input
                value={planUpload.durationWeeks}
                onChange={(e) => setPlanUpload((s) => ({ ...s, durationWeeks: e.target.value }))}
                placeholder="Duration weeks"
                inputMode="numeric"
              />

              <SelectField value={planUpload.sport} onChange={(e) => setPlanUpload((s) => ({ ...s, sport: e.target.value }))}>
                <option value="TRIATHLON">Triathlon</option>
                <option value="RUN">Run</option>
                <option value="BIKE">Bike</option>
                <option value="SWIM">Swim</option>
                <option value="DUATHLON">Duathlon</option>
              </SelectField>

              <SelectField value={planUpload.level} onChange={(e) => setPlanUpload((s) => ({ ...s, level: e.target.value }))}>
                <option value="BEGINNER">Beginner</option>
                <option value="INTERMEDIATE">Intermediate</option>
                <option value="ADVANCED">Advanced</option>
              </SelectField>

              <SelectField value={planUpload.distance} onChange={(e) => setPlanUpload((s) => ({ ...s, distance: e.target.value }))}>
                <option value="OTHER">Other</option>
                <option value="SPRINT">Sprint</option>
                <option value="OLYMPIC">Olympic</option>
                <option value="HALF_IRONMAN">Half Ironman</option>
                <option value="IRONMAN">Ironman</option>
                <option value="FIVE_K">5K</option>
                <option value="TEN_K">10K</option>
                <option value="HALF_MARATHON">Half Marathon</option>
                <option value="MARATHON">Marathon</option>
              </SelectField>

              <Input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) =>
                  setPlanUpload((s) => ({
                    ...s,
                    file: e.currentTarget.files && e.currentTarget.files.length ? e.currentTarget.files[0] : null,
                  }))
                }
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <Button type="button" variant="primary" size="sm" onClick={() => void uploadPlanSource()} disabled={planLibraryBusy}>
                {planLibraryBusy ? 'Uploading…' : 'Upload plan'}
              </Button>
              <span className="text-xs text-[var(--muted)]">PDF plans are parsed into session and rule templates.</span>
            </div>

            {planLibraryMessage ? <p className="mt-2 text-sm text-emerald-600">{planLibraryMessage}</p> : null}
            {planLibraryError ? <p className="mt-2 text-sm text-red-600">{planLibraryError}</p> : null}

            {planSources.length ? (
              <div className="mt-4 rounded-md border border-[var(--border-subtle)] p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Recently uploaded</p>
                <ul className="space-y-2 text-sm">
                  {planSources.slice(0, 8).map((src) => (
                    <li key={src.id} className="flex items-center justify-between gap-3">
                      <span className="truncate">{src.title}</span>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {src.durationWeeks}w · v{src.latestVersion?.version ?? 1}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Block>

          <Block className="w-full">
            <BlockTitle>Timezone</BlockTitle>
            <p className="mt-1 text-sm text-[var(--muted)]">Times and day-boundaries use your timezone.</p>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Current: <span className="text-[var(--text)] font-medium">{getTimezoneLabel(timezone)}</span>
            </p>
            <div className="mt-3">
              <TimezoneSelect value={timezone} onChange={handleTimezoneChange} disabled={savingTimezone} />
            </div>
            {timezoneMessage ? <p className="mt-3 text-sm text-emerald-600">{timezoneMessage}</p> : null}
            {timezoneError ? <p className="mt-3 text-sm text-red-600">{timezoneError}</p> : null}
          </Block>

          <Block className="w-full">
            <BlockTitle>Appearance</BlockTitle>
            <p className="mt-1 text-sm text-[var(--muted)]">Choose light, dark, or follow your system setting.</p>

            <div className="mt-3">
              <SelectField
                value={themePreference}
                onChange={(e) => setThemePreference(e.target.value as any)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </SelectField>
            </div>
          </Block>
        </div>
      </div>
    </section>
  );
}
