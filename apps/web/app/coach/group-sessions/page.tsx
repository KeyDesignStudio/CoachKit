'use client';

import { useCallback, useEffect, useState } from 'react';
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
  optionalFlag: boolean;
  targets: GroupSessionTarget[];
};

type ApplyResult = {
  createdCount: number;
  skippedExistingCount: number;
  createdIds: string[];
};

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
  const [createInitialValues, setCreateInitialValues] = useState<any>(null);

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

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || null;

  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      session.title.toLowerCase().includes(query) ||
      session.discipline.toLowerCase().includes(query) ||
      session.description?.toLowerCase().includes(query)
    );
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
            <div className="relative">
              <Icon name="filter" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                type="text"
                placeholder="Search..."
                className="pl-10 min-h-[44px]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
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
              <SessionCard key={session.id} session={session} onClick={() => setSelectedSessionId(session.id)} />
            ))}
          </div>

          {/* Drawer for Editing */}
          {selectedSession && (
            <GroupSessionDrawer
              session={selectedSession}
              athletes={athletes}
              onClose={() => setSelectedSessionId(null)}
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
