'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

type DefaultLocationResponse = {
  defaultLat: number | null;
  defaultLon: number | null;
  defaultLocationLabel: string | null;
};

type GeocodeResult = {
  label: string;
  name: string;
  admin1: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
};

type ReverseGeocodeResult = {
  label: string;
  latitude: number;
  longitude: number;
};

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function WeatherLocationSelect() {
  const { request } = useApi();

  const [savedLabel, setSavedLabel] = useState('');
  const [savedLat, setSavedLat] = useState<number | null>(null);
  const [savedLon, setSavedLon] = useState<number | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [geoError, setGeoError] = useState('');

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [advancedError, setAdvancedError] = useState('');

  const searchTimer = useRef<number | null>(null);
  const lastSearchToken = useRef(0);
  const advancedTimer = useRef<number | null>(null);

  const hasLocation = savedLat != null && savedLon != null;

  useEffect(() => {
    void (async () => {
      try {
        const data = await request<DefaultLocationResponse>('/api/me/default-location');
        const label = data.defaultLocationLabel ?? '';
        setSavedLabel(label);
        setSavedLat(data.defaultLat);
        setSavedLon(data.defaultLon);
        setQuery(label);
        setLatInput(data.defaultLat == null ? '' : String(data.defaultLat));
        setLonInput(data.defaultLon == null ? '' : String(data.defaultLon));
      } catch {
        // Keep UI usable if endpoint errors.
      }
    })();
  }, [request]);

  const doSave = async (next: { lat: number | null; lon: number | null; label: string | null }, opts?: { silent?: boolean }) => {
    setSaving(true);
    setError('');
    setMessage(opts?.silent ? '' : message);

    try {
      const updated = await request<DefaultLocationResponse>('/api/me/default-location', {
        method: 'PATCH',
        data: {
          defaultLat: next.lat,
          defaultLon: next.lon,
          defaultLocationLabel: next.lat == null ? null : next.label,
        },
      });

      const label = updated.defaultLocationLabel ?? '';
      setSavedLabel(label);
      setSavedLat(updated.defaultLat);
      setSavedLon(updated.defaultLon);
      setQuery(label);
      setLatInput(updated.defaultLat == null ? '' : String(updated.defaultLat));
      setLonInput(updated.defaultLon == null ? '' : String(updated.defaultLon));

      if (!opts?.silent) {
        setMessage(updated.defaultLat == null ? 'Weather location cleared.' : 'Weather location saved.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save weather location.');
    } finally {
      setSaving(false);
    }
  };

  const canSearch = useMemo(() => query.trim().length >= 2, [query]);

  useEffect(() => {
    if (!canSearch) {
      setResults([]);
      setSearching(false);
      return;
    }

    if (searchTimer.current) {
      window.clearTimeout(searchTimer.current);
    }

    // Debounce 300ms.
    searchTimer.current = window.setTimeout(() => {
      const token = ++lastSearchToken.current;
      setSearching(true);
      setError('');
      setMessage('');

      void (async () => {
        try {
          const data = await request<{ results: GeocodeResult[] }>(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
          if (token !== lastSearchToken.current) return;
          setResults(data.results ?? []);
          setOpen(true);
        } catch (err) {
          if (token !== lastSearchToken.current) return;
          setResults([]);
          setOpen(false);
          setError(err instanceof Error ? err.message : 'Failed to search locations.');
        } finally {
          if (token !== lastSearchToken.current) return;
          setSearching(false);
        }
      })();
    }, 300);

    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [canSearch, query, request]);

  const selectResult = async (item: GeocodeResult) => {
    setOpen(false);
    setResults([]);
    setQuery(item.label);

    await doSave({
      lat: item.latitude,
      lon: item.longitude,
      label: item.label,
    });
  };

  const useMyLocation = async () => {
    setGeoError('');
    setError('');
    setMessage('');

    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGeoError('Geolocation not available in this browser.');
      return;
    }

    setSaving(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const data = await request<ReverseGeocodeResult>(
            `/api/reverse-geocode?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`
          );

          await doSave({
            lat: data.latitude,
            lon: data.longitude,
            label: data.label,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to use current location.');
          setSaving(false);
        }
      },
      (err) => {
        if (err.code === 1) {
          setGeoError('Location permission denied');
        } else {
          setGeoError('Failed to read current location');
        }
        setSaving(false);
      },
      {
        enableHighAccuracy: false,
        timeout: 8_000,
        maximumAge: 60_000,
      }
    );
  };

  const onAdvancedChange = (nextLatRaw: string, nextLonRaw: string) => {
    setLatInput(nextLatRaw);
    setLonInput(nextLonRaw);
    setAdvancedError('');
    setMessage('');
    setError('');

    if (advancedTimer.current) {
      window.clearTimeout(advancedTimer.current);
    }

    advancedTimer.current = window.setTimeout(() => {
      const lat = parseNumberOrNull(nextLatRaw);
      const lon = parseNumberOrNull(nextLonRaw);

      const hasEither = lat != null || lon != null;
      const hasBoth = lat != null && lon != null;

      if (hasEither && !hasBoth) {
        setAdvancedError('Latitude and longitude must be provided together.');
        return;
      }

      if (lat != null && (lat < -90 || lat > 90)) {
        setAdvancedError('Latitude must be between -90 and 90.');
        return;
      }

      if (lon != null && (lon < -180 || lon > 180)) {
        setAdvancedError('Longitude must be between -180 and 180.');
        return;
      }

      // Keep the saved label as-is for minor manual edits.
      const label = lat == null ? null : savedLabel || null;
      void doSave({ lat, lon, label }, { silent: true });
    }, 400);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-[var(--muted)]">Search and select a location, or use your current position.</p>
        {hasLocation ? (
          <p className="text-xs text-[var(--muted)]">
            Using: <span className="font-medium text-[var(--text)]">{savedLabel || `${savedLat?.toFixed?.(4)}, ${savedLon?.toFixed?.(4)}`}</span>
          </p>
        ) : (
          <p className="text-xs text-[var(--muted)]">Not set.</p>
        )}
      </div>

      <div className="relative">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onFocus={() => {
            setGeoError('');
            if (results.length > 0) setOpen(true);
          }}
          onBlur={() => {
            // Let click selection register.
            window.setTimeout(() => {
              setOpen(false);
              setQuery(savedLabel);
            }, 120);
          }}
          placeholder="Search city or suburb (e.g. Brisbane, Bondi)"
          disabled={saving}
          aria-label="Weather location"
        />

        {open && results.length > 0 ? (
          <div
            className={cn(
              'absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-[var(--border-subtle)]',
              'bg-[var(--bg-card)] shadow-lg'
            )}
            role="listbox"
            aria-label="Location results"
          >
            {results.map((item) => (
              <button
                key={`${item.latitude},${item.longitude},${item.label}`}
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2 text-sm',
                  'hover:bg-[var(--bg-structure)] active:bg-[var(--bg-structure)]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-subtle)]'
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void selectResult(item)}
                role="option"
              >
                <div className="font-medium text-[var(--text)]">{item.label}</div>
                <div className="text-xs text-[var(--muted)]">
                  {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {searching ? <p className="mt-2 text-xs text-[var(--muted)]">Searching…</p> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void useMyLocation()} disabled={saving}>
          {saving ? 'Working…' : 'Use my current location'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void doSave({ lat: null, lon: null, label: null })}
          disabled={saving}
        >
          Clear
        </Button>
      </div>

      {geoError ? <p className="text-sm text-amber-700">{geoError}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <button
          type="button"
          className="text-sm font-medium text-[var(--text)]"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          Advanced
        </button>

        {advancedOpen ? (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Latitude</p>
              <Input
                value={latInput}
                onChange={(e) => onAdvancedChange(e.target.value, lonInput)}
                placeholder="-27.468"
                inputMode="decimal"
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Longitude</p>
              <Input
                value={lonInput}
                onChange={(e) => onAdvancedChange(latInput, e.target.value)}
                placeholder="153.023"
                inputMode="decimal"
                disabled={saving}
              />
            </div>
            {advancedError ? <p className="md:col-span-2 text-sm text-red-700">{advancedError}</p> : null}
            <p className="md:col-span-2 text-xs text-[var(--muted)]">
              Manual edits keep the saved location name as-is.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
