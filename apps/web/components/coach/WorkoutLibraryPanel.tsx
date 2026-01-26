'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { LibraryListItem } from './types';

export type { LibraryListItem };

type Discipline = 'RUN' | 'BIKE' | 'SWIM' | 'BRICK' | 'STRENGTH' | 'OTHER';

type IntensityCategory = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | 'RPE' | 'OTHER';

type SortKey = 'relevance' | 'newest' | 'popular' | 'durationAsc' | 'durationDesc' | 'intensityAsc' | 'intensityDesc' | 'titleAsc';


type LibraryListResponse = {
  items: LibraryListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type LibraryDetailSession = Omit<LibraryListItem, 'favorite'> & {
  notes: string | null;
  workoutStructure: unknown | null;
  createdAt: string;
};

type LibraryDetailResponse = {
  session: LibraryDetailSession;
  favorite: boolean;
};

type WorkoutLibraryPanelProps = {
  onUseTemplate: (session: LibraryDetailSession) => void;
  mode?: 'library' | 'favorites';
  insertMode?: boolean;
};

function formatDurationMinutes(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '';
  const minutes = Math.round(durationSec / 60);
  return `${minutes} min`;
}

function formatDistance(distanceMeters: number | null): string {
  if (!distanceMeters || !Number.isFinite(distanceMeters) || distanceMeters <= 0) return '';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function disciplineLabel(d: Discipline) {
  switch (d) {
    case 'RUN':
      return 'Run';
    case 'BIKE':
      return 'Bike';
    case 'SWIM':
      return 'Swim';
    case 'BRICK':
      return 'Brick';
    case 'STRENGTH':
      return 'Strength';
    case 'OTHER':
      return 'Other';
  }
}

function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function asStructureSegments(structure: unknown): Array<Record<string, unknown>> | null {
  if (!structure) return null;
  if (Array.isArray(structure)) {
    return structure.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object');
  }

  if (typeof structure === 'object') {
    const maybe = structure as Record<string, unknown>;
    const segments = maybe.segments;
    if (Array.isArray(segments)) {
      return segments.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object');
    }
  }

  return null;
}

function segmentLabel(segment: Record<string, unknown>): string {
  const label = typeof segment.label === 'string' ? segment.label.trim() : '';
  const name = typeof segment.name === 'string' ? segment.name.trim() : '';
  const title = typeof segment.title === 'string' ? segment.title.trim() : '';
  const kind = typeof segment.type === 'string' ? segment.type.trim() : '';
  return label || name || title || kind || 'Segment';
}

function segmentMeta(segment: Record<string, unknown>): string {
  const durationSec = typeof segment.durationSec === 'number' ? segment.durationSec : null;
  const distanceMeters = typeof segment.distanceMeters === 'number' ? segment.distanceMeters : null;
  const reps = typeof segment.reps === 'number' ? segment.reps : null;
  const intensity = typeof segment.intensity === 'string' ? segment.intensity.trim() : '';

  const parts: string[] = [];
  if (typeof reps === 'number' && Number.isFinite(reps) && reps > 1) parts.push(`${reps}x`);
  if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) parts.push(formatDurationMinutes(durationSec));
  const dist = formatDistance(distanceMeters);
  if (dist) parts.push(dist);
  if (intensity) parts.push(intensity);
  return parts.join(' • ');
}

export function WorkoutLibraryPanel({ onUseTemplate, mode = 'library', insertMode = false }: WorkoutLibraryPanelProps) {
  const { request } = useApi();

  const [q, setQ] = useState('');
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [tagsInput, setTagsInput] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [durationMax, setDurationMax] = useState('');
  const [intensityTarget, setIntensityTarget] = useState('');
  const [intensityCategory, setIntensityCategory] = useState<IntensityCategory | ''>('');
  const [sort, setSort] = useState<SortKey>('relevance');
  const [page, setPage] = useState(1);

  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<LibraryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState<LibraryDetailResponse | null>(null);

  const pageSize = 20;

  const tags = useMemo(() => parseCsv(tagsInput), [tagsInput]);
  const activeTagSet = useMemo(() => new Set(tags.map((t) => t.toLowerCase())), [tags]);

  const favoritesOnly = mode === 'favorites';

  const hasActiveFilters =
    Boolean(q.trim()) ||
    disciplines.length > 0 ||
    tags.length > 0 ||
    Boolean(durationMin.trim()) ||
    Boolean(durationMax.trim()) ||
    Boolean(intensityTarget.trim()) ||
    Boolean(intensityCategory);

  const setTagsFromArray = useCallback((nextTags: string[]) => {
    const next = nextTags
      .map((t) => t.trim())
      .filter(Boolean)
      .join(', ');
    setTagsInput(next);
  }, []);

  const toggleTagFilter = useCallback(
    (tag: string) => {
      const normalized = tag.trim();
      if (!normalized) return;
      const isActive = activeTagSet.has(normalized.toLowerCase());
      const nextTags = isActive ? tags.filter((t) => t.toLowerCase() !== normalized.toLowerCase()) : [...tags, normalized];
      setTagsFromArray(nextTags);
      setPage(1);
    },
    [activeTagSet, setTagsFromArray, tags]
  );

  const clearFilters = useCallback(() => {
    setQ('');
    setDisciplines([]);
    setTagsInput('');
    setDurationMin('');
    setDurationMax('');
    setIntensityTarget('');
    setIntensityCategory('');
    setSort('relevance');
    setPage(1);
  }, []);

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    for (const d of disciplines) params.append('discipline', d);
    for (const tag of tags) params.append('tags', tag);
    const dMin = Number.parseInt(durationMin, 10);
    const dMax = Number.parseInt(durationMax, 10);
    if (Number.isFinite(dMin) && dMin >= 0) params.set('durationMin', String(dMin));
    if (Number.isFinite(dMax) && dMax >= 0) params.set('durationMax', String(dMax));
    if (intensityTarget.trim()) params.set('intensityTarget', intensityTarget.trim());
    if (intensityCategory) params.set('intensityCategory', intensityCategory);
    if (sort !== 'relevance') params.set('sort', sort);
    if (favoritesOnly) params.set('favoritesOnly', '1');
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return `/api/coach/workout-library?${params.toString()}`;
  }, [q, disciplines, durationMin, durationMax, intensityTarget, intensityCategory, sort, favoritesOnly, tags, page]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await request<LibraryListResponse>(listUrl);
      setItems((prev) => {
        if (data.page <= 1) return data.items;
        const seen = new Set(prev.map((it) => it.id));
        const next = data.items.filter((it) => !seen.has(it.id));
        return [...prev, ...next];
      });
      setTotal(data.total);
      setLastUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workout library.');
    } finally {
      setLoading(false);
    }
  }, [listUrl, request]);

  const showLastUpdated = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DIAG_MODE === '1';

  useEffect(() => {
    loadList();
  }, [loadList]);

  const canLoadMore = !loading && items.length < total;

  const loadDetail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetail(null);
      setDetailLoading(true);
      setDetailError('');
      try {
        const data = await request<LibraryDetailResponse>(`/api/coach/workout-library/${id}`);
        
        if (insertMode) {
          onUseTemplate(data.session);
          setSelectedId(null); // Reset selection to close/avoid detail view
          return;
        }

        setDetail(data);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : 'Failed to load workout.');
      } finally {
        setDetailLoading(false);
      }
    },
    [request, insertMode, onUseTemplate]
  );

  const toggleFavorite = useCallback(
    async (id: string, next: boolean) => {
      await request(`/api/coach/workout-library/${id}/favorite`, {
        method: next ? 'POST' : 'DELETE',
      });

      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorite: next } : it)));
      setDetail((prev) => (prev && prev.session.id === id ? { ...prev, favorite: next } : prev));
    },
    [request]
  );

  const handleUse = useCallback(async () => {
    if (!detail) return;
    await request(`/api/coach/workout-library/${detail.session.id}/used`, { method: 'POST' });
    onUseTemplate(detail.session);
    setSelectedId(null);
    setDetail(null);
  }, [detail, onUseTemplate, request]);

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-3xl border border-white/20 bg-white/40 px-4 py-4 md:px-6 md:py-5 backdrop-blur-3xl shadow-inner">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-[var(--muted)]">Library</p>
            <h2 className="text-xl md:text-2xl font-semibold">{mode === 'favorites' ? 'Favorites' : 'Workout Library'}</h2>
            <p className="text-xs md:text-sm text-[var(--muted)]">
              {mode === 'favorites'
                ? 'Your saved templates'
                : 'Browse templates, favorite, and inject into Session Builder'}
            </p>
            {showLastUpdated ? (
              <p className="mt-1 text-[11px] text-[var(--muted)]" data-testid="workout-library-last-updated">
                Last updated: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : '…'}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative md:col-span-3">
              <Icon name="filter" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                type="text"
                placeholder="Search workouts (title/intensity)…"
                className="min-h-[44px] pl-10"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="md:col-span-3 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2">
                {(['RUN', 'BIKE', 'SWIM', 'BRICK', 'STRENGTH', 'OTHER'] as const).map((d) => {
                  const active = disciplines.includes(d);
                  return (
                    <Button
                      key={d}
                      type="button"
                      size="sm"
                      variant={active ? 'primary' : 'secondary'}
                      onClick={() => {
                        setDisciplines((prev) => {
                          const next = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d];
                          return next;
                        });
                        setPage(1);
                      }}
                    >
                      {disciplineLabel(d)}
                    </Button>
                  );
                })}

                {(disciplines.length > 0 || q.trim() || tags.length > 0 || durationMin.trim() || durationMax.trim() || intensityTarget.trim() || intensityCategory) && (
                  <Button type="button" size="sm" variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
              </div>

              <div className="ml-auto flex items-center gap-2">
                <label className="text-xs text-[var(--muted)]">Sort</label>
                <select
                  className="min-h-[36px] rounded-xl border border-white/30 bg-white/60 px-3 text-sm text-[var(--text)]"
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as SortKey);
                    setPage(1);
                  }}
                  aria-label="Sort workouts"
                >
                  <option value="relevance">Relevance</option>
                  <option value="popular">Most used</option>
                  <option value="newest">Newest</option>
                  <option value="durationAsc">Duration (short → long)</option>
                  <option value="durationDesc">Duration (long → short)</option>
                  <option value="intensityAsc">Intensity (easy → hard)</option>
                  <option value="intensityDesc">Intensity (hard → easy)</option>
                  <option value="titleAsc">Title (A → Z)</option>
                </select>

                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowMoreFilters((v) => !v)}
                >
                  {showMoreFilters ? 'Less filters' : 'More filters'}
                </Button>
              </div>
            </div>

            {tags.length > 0 && (
              <div className="md:col-span-3 flex flex-wrap items-center gap-2">
                <p className="text-xs text-[var(--muted)]">Tags:</p>
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)] hover:bg-white/60"
                    onClick={() => toggleTagFilter(tag)}
                    aria-label={`Remove tag filter ${tag}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {showMoreFilters && (
              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  type="text"
                  placeholder="Tags (comma-separated)"
                  className="min-h-[44px] md:col-span-3"
                  value={tagsInput}
                  onChange={(e) => {
                    setTagsInput(e.target.value);
                    setPage(1);
                  }}
                />

                <div className="md:col-span-2">
                  <Input
                    type="text"
                    placeholder="Intensity (e.g. Z2, Tempo, Easy)"
                    className="min-h-[44px]"
                    value={intensityTarget}
                    onChange={(e) => {
                      setIntensityTarget(e.target.value);
                      setPage(1);
                    }}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map((z) => (
                      <Button
                        key={z}
                        type="button"
                        size="sm"
                        variant={intensityTarget.trim().toUpperCase() === z ? 'primary' : 'secondary'}
                        onClick={() => {
                          setIntensityTarget(z);
                          setPage(1);
                        }}
                      >
                        {z}
                      </Button>
                    ))}

                    {intensityTarget.trim() && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setIntensityTarget('');
                          setPage(1);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="Min (min)"
                    className="min-h-[44px]"
                    value={durationMin}
                    onChange={(e) => {
                      setDurationMin(e.target.value);
                      setPage(1);
                    }}
                  />
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="Max (min)"
                    className="min-h-[44px]"
                    value={durationMax}
                    onChange={(e) => {
                      setDurationMax(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>

                <div className="md:col-span-3 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-[var(--muted)]">Intensity category</label>
                  <select
                    className="min-h-[44px] rounded-xl border border-white/30 bg-white/60 px-3 text-sm text-[var(--text)]"
                    value={intensityCategory}
                    onChange={(e) => {
                      setIntensityCategory(e.target.value as IntensityCategory | '');
                      setPage(1);
                    }}
                    aria-label="Intensity category"
                  >
                    <option value="">All</option>
                    <option value="Z1">Z1</option>
                    <option value="Z2">Z2</option>
                    <option value="Z3">Z3</option>
                    <option value="Z4">Z4</option>
                    <option value="Z5">Z5</option>
                    <option value="RPE">RPE</option>
                    <option value="OTHER">Other</option>
                  </select>

                  {intensityCategory && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setIntensityCategory('');
                        setPage(1);
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-rose-500">{error}</p>}
          {loading && <p className="text-sm text-[var(--muted)]">Loading library…</p>}
        </div>
      </div>

      <div className={cn(
        "grid gap-4 sm:gap-5",
        insertMode ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      )}>
        {!loading && items.length === 0 && (
          <div className="col-span-full rounded-3xl border border-white/20 bg-white/40 p-8 text-center backdrop-blur-3xl">
            {favoritesOnly ? (
              <p className="text-[var(--muted)]">{hasActiveFilters ? 'No workouts match your filters.' : 'No favorites yet.'}</p>
            ) : (
              <p className="text-[var(--muted)]">
                {hasActiveFilters
                  ? 'No workouts match your filters.'
                  : 'No published workouts yet. Ask an admin to publish library workouts.'}
              </p>
            )}
          </div>
        )}

        {items.map((it) => (
          <div
            key={it.id}
            className="group relative rounded-3xl border border-white/20 bg-white/40 p-4 backdrop-blur-3xl shadow-inner cursor-pointer hover:bg-white/50"
            onClick={() => loadDetail(it.id)}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">{disciplineLabel(it.discipline)}</p>
                <h3 className="mt-1 font-semibold leading-snug truncate">{it.title}</h3>
                <p className="mt-1 text-xs text-[var(--muted)] truncate">{it.intensityTarget}</p>
              </div>

              <button
                type="button"
                className="rounded-full border border-white/30 bg-white/60 p-2 hover:bg-white/80"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(it.id, !it.favorite).catch(() => {
                    // UI will show error on next refetch; keep silent here.
                  });
                }}
                aria-label={it.favorite ? 'Unfavorite workout' : 'Favorite workout'}
              >
                <Icon name="favorite" filled={it.favorite} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {it.category ? (
                <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                  {it.category}
                </span>
              ) : null}
              {formatDurationMinutes(it.durationSec) && (
                <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                  {formatDurationMinutes(it.durationSec)}
                </span>
              )}
              {formatDistance(it.distanceMeters) && (
                <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                  {formatDistance(it.distanceMeters)}
                </span>
              )}
              {it.intensityTarget.trim() ? (
                <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                  {it.intensityTarget}
                </span>
              ) : null}
              {it.tags.slice(0, 3).map((tag) => {
                const active = activeTagSet.has(tag.toLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    className={
                      'rounded-full border px-3 py-1 text-xs hover:bg-white/60 ' +
                      (active
                        ? 'border-white/60 bg-white/70 text-[var(--text)]'
                        : 'border-white/30 bg-white/40 text-[var(--muted)]')
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTagFilter(tag);
                    }}
                    aria-label={`Filter by tag ${tag}`}
                  >
                    {tag}
                  </button>
                );
              })}
              {it.tags.length > 3 && (
                <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                  +{it.tags.length - 3}
                </span>
              )}
            </div>

            <p className="mt-3 text-sm text-[var(--text)] line-clamp-3">{it.description}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--muted)]">{total === 0 ? '0 results' : `Showing ${items.length} of ${total}`}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canLoadMore}
          onClick={() => setPage((p) => p + 1)}
        >
          Load more
        </Button>
      </div>

      {/* Detail drawer */}
      {selectedId && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setSelectedId(null)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-xl overflow-y-auto border-l border-white/20 bg-white/60 backdrop-blur-3xl shadow-2xl">
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
                    {detail?.session ? disciplineLabel(detail.session.discipline) : 'Workout'}
                  </p>
                  <h3 className="mt-1 text-2xl font-semibold leading-snug break-words">
                    {detail?.session ? detail.session.title : 'Loading…'}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded-full border border-white/30 bg-white/70 p-2 hover:bg-white/90"
                  aria-label="Close"
                >
                  <Icon name="close" />
                </button>
              </div>

              {detailError && <p className="text-sm text-rose-500">{detailError}</p>}
              {detailLoading && <p className="text-sm text-[var(--muted)]">Loading workout…</p>}

              {detail?.session && (
                <>
                  <div className="rounded-2xl border border-white/20 bg-white/40 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Overview</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {detail.session.category ? (
                        <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                          {detail.session.category}
                        </span>
                      ) : null}
                      {formatDurationMinutes(detail.session.durationSec) && (
                        <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                          {formatDurationMinutes(detail.session.durationSec)}
                        </span>
                      )}
                      {formatDistance(detail.session.distanceMeters) && (
                        <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                          {formatDistance(detail.session.distanceMeters)}
                        </span>
                      )}
                      {detail.session.intensityTarget.trim() ? (
                        <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                          {detail.session.intensityTarget}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/20 bg-white/40 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Workout Detail</p>
                    <p className="mt-2 text-sm text-[var(--text)] whitespace-pre-wrap">{detail.session.description}</p>
                  </div>

                  {detail.session.notes && (
                    <div className="rounded-2xl border border-white/20 bg-white/40 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Notes</p>
                      <p className="mt-2 text-sm whitespace-pre-wrap">{detail.session.notes}</p>
                    </div>
                  )}

                  {!!detail.session.equipment?.length && (
                    <div className="rounded-2xl border border-white/20 bg-white/40 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Equipment</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {detail.session.equipment.map((eq) => (
                          <span
                            key={eq}
                            className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]"
                          >
                            {eq}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {detail.session.workoutStructure && (
                    <div className="rounded-2xl border border-white/20 bg-white/40 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Structure</p>
                      {(() => {
                        const segments = asStructureSegments(detail.session.workoutStructure);
                        if (segments && segments.length > 0) {
                          return (
                            <div className="mt-2 flex flex-col gap-2">
                              {segments.slice(0, 50).map((seg, idx) => (
                                <div key={idx} className="rounded-xl border border-white/20 bg-white/40 p-3">
                                  <p className="text-sm font-medium">{segmentLabel(seg)}</p>
                                  {segmentMeta(seg) && <p className="mt-1 text-xs text-[var(--muted)]">{segmentMeta(seg)}</p>}
                                  {typeof seg.notes === 'string' && seg.notes.trim() && (
                                    <p className="mt-2 text-sm whitespace-pre-wrap">{seg.notes.trim()}</p>
                                  )}
                                </div>
                              ))}
                              {segments.length > 50 && (
                                <p className="text-xs text-[var(--muted)]">Showing first 50 segments…</p>
                              )}
                            </div>
                          );
                        }

                        return (
                          <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-white/20 bg-white/40 p-3 text-xs text-[var(--muted)]">
                            {JSON.stringify(detail.session.workoutStructure, null, 2)}
                          </pre>
                        );
                      })()}
                    </div>
                  )}

                  {!!detail.session.tags.length && (
                    <div className="flex flex-wrap gap-2">
                      {detail.session.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]"
                          onClick={() => {
                            toggleTagFilter(tag);
                            setSelectedId(null);
                            setDetail(null);
                          }}
                          aria-label={`Filter by tag ${tag}`}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant={detail.favorite ? 'secondary' : 'primary'}
                      onClick={() => toggleFavorite(detail.session.id, !detail.favorite)}
                      className="w-full"
                    >
                      <Icon name="favorite" filled={detail.favorite} className="mr-1" />
                      {detail.favorite ? 'Favorited' : 'Favorite'}
                    </Button>

                    <Button type="button" variant="primary" onClick={handleUse} className="w-full">
                      <Icon name="add" className="mr-1" />
                      Use in Session Builder
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
