'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from '@/components/api-client';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

type Discipline = 'RUN' | 'BIKE' | 'SWIM' | 'BRICK' | 'STRENGTH' | 'OTHER';

type LibraryListItem = {
  id: string;
  title: string;
  discipline: Discipline;
  tags: string[];
  description: string;
  durationSec: number;
  intensityTarget: string;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  equipment: string[];
  updatedAt: string;
  favorite: boolean;
};

type LibraryListResponse = {
  items: LibraryListItem[];
  total: number;
  page: number;
  pageSize: number;
};

type LibraryDetailSession = Omit<LibraryListItem, 'favorite'> & {
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
};

function formatDurationMinutes(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '';
  const minutes = Math.round(durationSec / 60);
  return `${minutes} min`;
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

export function WorkoutLibraryPanel({ onUseTemplate }: WorkoutLibraryPanelProps) {
  const { request } = useApi();

  const [q, setQ] = useState('');
  const [discipline, setDiscipline] = useState<Discipline | ''>('');
  const [tagsInput, setTagsInput] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<LibraryListItem[]>([]);
  const [total, setTotal] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState<LibraryDetailResponse | null>(null);

  const pageSize = 20;

  const tags = useMemo(() => parseCsv(tagsInput), [tagsInput]);

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (discipline) params.append('discipline', discipline);
    for (const tag of tags) params.append('tags', tag);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return `/api/coach/workout-library?${params.toString()}`;
  }, [q, discipline, tags, page]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await request<LibraryListResponse>(listUrl);
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workout library.');
    } finally {
      setLoading(false);
    }
  }, [listUrl, request]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  const loadDetail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetail(null);
      setDetailLoading(true);
      setDetailError('');
      try {
        const data = await request<LibraryDetailResponse>(`/api/coach/workout-library/${id}`);
        setDetail(data);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : 'Failed to load workout.');
      } finally {
        setDetailLoading(false);
      }
    },
    [request]
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
            <h2 className="text-xl md:text-2xl font-semibold">Workout Library</h2>
            <p className="text-xs md:text-sm text-[var(--muted)]">Browse templates, favorite, and inject into Session Builder</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative md:col-span-2">
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

            <Select
              value={discipline}
              onChange={(e) => {
                setDiscipline(e.target.value as Discipline | '');
                setPage(1);
              }}
              className="min-h-[44px]"
            >
              <option value="">All disciplines</option>
              <option value="RUN">Run</option>
              <option value="BIKE">Bike</option>
              <option value="SWIM">Swim</option>
              <option value="BRICK">Brick</option>
              <option value="STRENGTH">Strength</option>
              <option value="OTHER">Other</option>
            </Select>

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
          </div>

          {error && <p className="text-sm text-rose-500">{error}</p>}
          {loading && <p className="text-sm text-[var(--muted)]">Loading library…</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {!loading && items.length === 0 && (
          <div className="col-span-full rounded-3xl border border-white/20 bg-white/40 p-8 text-center backdrop-blur-3xl">
            <p className="text-[var(--muted)]">No workouts match your filters.</p>
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
              {formatDurationMinutes(it.durationSec) && (
                <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                  {formatDurationMinutes(it.durationSec)}
                </span>
              )}
              {it.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]"
                >
                  {tag}
                </span>
              ))}
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

      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]">
          {total === 0 ? '0 results' : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <Icon name="prev" />
            Prev
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= maxPage}
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          >
            Next
            <Icon name="next" />
          </Button>
        </div>
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
                  <div className="flex flex-wrap gap-2">
                    {formatDurationMinutes(detail.session.durationSec) && (
                      <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                        {formatDurationMinutes(detail.session.durationSec)}
                      </span>
                    )}
                    <span className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]">
                      {detail.session.intensityTarget}
                    </span>
                  </div>

                  <p className="text-sm text-[var(--text)] whitespace-pre-wrap">{detail.session.description}</p>

                  {detail.session.notes && (
                    <div className="rounded-2xl border border-white/20 bg-white/40 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Notes</p>
                      <p className="mt-2 text-sm whitespace-pre-wrap">{detail.session.notes}</p>
                    </div>
                  )}

                  {!!detail.session.tags.length && (
                    <div className="flex flex-wrap gap-2">
                      {detail.session.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-white/30 bg-white/40 px-3 py-1 text-xs text-[var(--muted)]"
                        >
                          {tag}
                        </span>
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
