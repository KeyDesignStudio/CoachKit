'use client';

import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/Input';

type GeocodeResult = {
  label: string;
  latitude: number;
  longitude: number;
};

type LocationInputWithGeocodeProps = {
  value: string;
  onValueChange: (value: string) => void;
  latitude: number | null;
  longitude: number | null;
  onCoordinatesChange: (latitude: number | null, longitude: number | null) => void;
  placeholder?: string;
};

export function LocationInputWithGeocode({
  value,
  onValueChange,
  latitude,
  longitude,
  onCoordinatesChange,
  placeholder,
}: LocationInputWithGeocodeProps) {
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const trimmed = useMemo(() => value.trim(), [value]);

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error('Failed to geocode location.');
        }
        const json = (await res.json()) as { data?: { results?: GeocodeResult[] } };
        setResults(json?.data?.results ?? []);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        setResults([]);
        setSearchError('Could not fetch place suggestions.');
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmed]);

  return (
    <div className="space-y-2">
      <Input
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          onCoordinatesChange(null, null);
        }}
        placeholder={placeholder}
      />

      {trimmed.length >= 2 && (searching || results.length > 0 || searchError) ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
          {searching ? <p className="text-xs text-[var(--muted)]">Searching places...</p> : null}
          {!searching && searchError ? <p className="text-xs text-rose-500">{searchError}</p> : null}
          {!searching && !searchError && results.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No matching places found.</p>
          ) : null}
          {!searching && !searchError && results.length > 0 ? (
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {results.map((result) => (
                <button
                  key={`${result.label}-${result.latitude}-${result.longitude}`}
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-xs text-[var(--fg)] hover:bg-[var(--bg-card)]"
                  onClick={() => {
                    onValueChange(result.label);
                    onCoordinatesChange(result.latitude, result.longitude);
                    setResults([]);
                  }}
                >
                  {result.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {latitude != null && longitude != null ? (
        <p className="text-xs text-[var(--muted)]">
          Pin: {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </p>
      ) : null}
    </div>
  );
}
