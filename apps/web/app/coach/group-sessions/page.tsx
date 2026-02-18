'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { SessionCard } from '@/components/coach/SessionCard';
import { GroupSessionDrawer } from '@/components/coach/GroupSessionDrawer';
import { CreateSessionModal } from '@/components/coach/CreateSessionModal';

type GroupVisibility = 'ALL' | 'SQUAD' | 'SELECTED';

type AthleteOption = {
  user: {
    id: string;
    name: string | null;
  };
};

type GroupSessionTarget = {
  id: string;
  athleteId: string | null;
  squadId: string | null;
  athlete?: {
    user: {
      id: string;
      name: string | null;
    } | null;
  } | null;
  squad?: {
    id: string;
    name: string;
  } | null;
};

type GroupSessionRecord = {
  id: string;
  title: string;
  discipline: string;
  location: string | null;
  startTimeLocal: string;
  durationMinutes: number;
  description: string | null;
  recurrenceRule: string;
  visibilityType: GroupVisibility;
  targets: GroupSessionTarget[];
};

type ApplyResult = {
  createdCount: number;
  skippedExistingCount: number;
  createdIds: string[];
};

const DAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

function parseRuleDays(rule: string): string[] {
  if (!rule) return [];
  const byDay = rule
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([k]) => String(k).toUpperCase() === 'BYDAY');
  if (!byDay?.[1]) return [];
  return byDay[1]
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter((token): token is (typeof DAY_ORDER)[number] => DAY_ORDER.includes(token as (typeof DAY_ORDER)[number]));
}

export default function CoachGroupSessionsPage() {
  const { user, loading: userLoading } = useAuthUser();
  const { request } = useApi();
  const [sessions, setSessions] = useState<GroupSessionRecord[]>([]);
  const [athletes, setAthletes] = useState<AthleteOption[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [pageError, setPageError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [createInitialValues, setCreateInitialValues] = useState<any>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const isCoach = user?.role === 'COACH';

  const loadSessions = useCallback(async () => {
    if (!isCoach || !user?.userId) return;
    setLoadingSessions(true);
    setPageError('');
    try {
      const data = await request<{ groupSessions: GroupSessionRecord[] }>('/api/coach/group-sessions');
      setSessions(data.groupSessions);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to load group sessions.');
    } finally {
      setLoadingSessions(false);
    }
  }, [isCoach, request, user?.userId]);

  const loadAthletes = useCallback(async () => {
    if (!isCoach || !user?.userId) return;
    try {
      const data = await request<{ athletes: AthleteOption[] }>('/api/coach/athletes');
      setAthletes(data.athletes);
    } catch (error) {
      console.error('Failed to load athletes:', error);
    }
  }, [isCoach, request, user?.userId]);

  useEffect(() => {
    loadSessions();
    loadAthletes();
  }, [loadSessions, loadAthletes]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target.isContentEditable);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isCreateModalOpen || selectedSessionId) return;

      if (event.key === '/') {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key.toLowerCase() === 'n') {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        setIsCreateModalOpen(true);
        return;
      }

      if (event.key === 'Escape') {
        if (searchQuery || locationQuery) {
          event.preventDefault();
          setSearchQuery('');
          setLocationQuery('');
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isCreateModalOpen, locationQuery, searchQuery, selectedSessionId]);

  const handleCreate = async (payload: any): Promise<string> => {
    try {
      const data = await request<{ groupSession: GroupSessionRecord }>('/api/coach/group-sessions', {
        method: 'POST',
        data: payload,
      });
      setStatusMessage('Created group session.');
      await loadSessions();
      // Return the new session ID so we can open it in the drawer
      return data.groupSession.id;
    } catch (error) {
      throw error;
    }
  };

  const handleSave = async (sessionId: string, payload: any) => {
    try {
      await request(`/api/coach/group-sessions/${sessionId}`, {
        method: 'PATCH',
        data: payload,
      });
      setStatusMessage('Updated group session.');
      await loadSessions();
    } catch (error) {
      throw error;
    }
  };

  const handleDelete = async (sessionId: string) => {
    try {
      await request(`/api/coach/group-sessions/${sessionId}`, {
        method: 'DELETE',
      });
      setStatusMessage('Deleted group session.');
      await loadSessions();
    } catch (error) {
      throw error;
    }
  };

  const handleApply = async (sessionId: string, from: string, to: string): Promise<ApplyResult> => {
    try {
      const data = await request<ApplyResult>(`/api/coach/group-sessions/${sessionId}/apply`, {
        method: 'POST',
        data: { from, to },
      });
      setStatusMessage(`Applied session: ${data.createdCount} created, ${data.skippedExistingCount} skipped.`);
      return data;
    } catch (error) {
      throw error;
    }
  };

  const handleCreateSuccess = async (payload: any): Promise<string> => {
    const newSessionId = await handleCreate(payload);
    setIsCreateModalOpen(false);
    setCreateInitialValues(null);
    // Open the newly created session in the drawer
    setSelectedSessionId(newSessionId);
    return newSessionId;
  };

  const handleDuplicateSession = useCallback((session: GroupSessionRecord) => {
    const selectedDays = parseRuleDays(session.recurrenceRule);
    setCreateInitialValues({
      title: `${session.title} (Copy)`,
      discipline: session.discipline,
      location: session.location ?? '',
      startTimeLocal: session.startTimeLocal,
      durationMinutes: String(session.durationMinutes),
      description: session.description ?? '',
      selectedDays: selectedDays.length ? selectedDays : ['MO'],
      visibilityType: session.visibilityType,
      targetAthleteIds: session.targets
        .map((target) => target.athleteId)
        .filter((value): value is string => Boolean(value)),
      squadInput: session.targets
        .map((target) => target.squadId)
        .filter(Boolean)
        .join(', '),
    });
    setSelectedSessionId(null);
    setIsCreateModalOpen(true);
  }, []);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || null;

  const filteredSessions = sessions.filter((session) => {
    const textQuery = searchQuery.trim().toLowerCase();
    const locQuery = locationQuery.trim().toLowerCase();
    const textOk =
      !textQuery ||
      session.title.toLowerCase().includes(textQuery) ||
      session.discipline.toLowerCase().includes(textQuery) ||
      session.description?.toLowerCase().includes(textQuery);
    const locationOk = !locQuery || (session.location ?? '').toLowerCase().includes(locQuery);
    return textOk && locationOk;
  });

  if (!isCoach) {
    return <p className="text-[var(--muted)]">Please switch to a coach identity to manage group sessions.</p>;
  }

  return (
    <section className="flex flex-col gap-6">
      {/* Header */}
      <header className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-4 md:px-6 md:py-5 shadow-inner">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-[var(--muted)]">Coaching</p>
              <h1 className="text-2xl md:text-3xl font-semibold">Recurring Group Sessions</h1>
              <p className="text-xs md:text-sm text-[var(--muted)]">Create recurring templates to apply to athlete calendars</p>
            </div>
            <Button type="button" onClick={() => setIsCreateModalOpen(true)} variant="primary" className="min-h-[44px] w-full md:w-auto">
              <Icon name="add" size="sm" className="md:mr-1" />
              <span className="hidden md:inline">New </span>Session
            </Button>
          </div>

          {/* Search Bar */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="relative">
                <Icon name="filter" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search title/discipline..."
                  className="pl-10 min-h-[44px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Input
                type="text"
                placeholder="Filter by location..."
                className="min-h-[44px]"
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
              />
            </div>
            <p className="text-xs text-[var(--muted)]">Shortcuts: <kbd>/</kbd> search, <kbd>N</kbd> new session, <kbd>Esc</kbd> clear filters.</p>
          </div>
        </div>

        {pageError && <p className="mt-3 text-sm text-rose-500">{pageError}</p>}
        {statusMessage && <p className="mt-3 text-sm text-emerald-600">{statusMessage}</p>}
        {loadingSessions && <p className="mt-3 text-sm text-[var(--muted)]">Loading sessions...</p>}
      </header>

      {/* Sessions List */}
      <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {!loadingSessions && filteredSessions.length === 0 && !searchQuery && (
          <div className="col-span-full rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
                <p className="text-[var(--muted)]">No group sessions yet. Create one to get started.</p>
              </div>
            )}

            {!loadingSessions && filteredSessions.length === 0 && searchQuery && (
              <div className="col-span-full rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
                <p className="text-[var(--muted)]">No sessions match your search.</p>
              </div>
            )}

            {filteredSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onClick={() => setSelectedSessionId(session.id)}
                onLocationClick={(location) => setLocationQuery(location)}
              />
            ))}
          </div>

          {/* Drawer for Editing */}
          {selectedSession && (
            <GroupSessionDrawer
              session={selectedSession}
              athletes={athletes}
              onClose={() => setSelectedSessionId(null)}
              onDuplicate={handleDuplicateSession}
              onSave={handleSave}
              onDelete={handleDelete}
              onApply={handleApply}
            />
          )}


      {/* Modal for Creating */}
      <CreateSessionModal
        isOpen={isCreateModalOpen}
        athletes={athletes}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreateSuccess}
        initialValues={createInitialValues}
      />
    </section>
  );
}
