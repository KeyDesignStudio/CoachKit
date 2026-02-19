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

type SquadTemplateTarget = {
  id: string;
  squadId: string;
  squad: {
    id: string;
    name: string;
  };
};

type SquadTemplateRecord = {
  id: string;
  name: string;
  description: string | null;
  targetPresetJson: unknown;
  targets: SquadTemplateTarget[];
  updatedAt: string;
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
  const [templateError, setTemplateError] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [squadTemplates, setSquadTemplates] = useState<SquadTemplateRecord[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
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

  const loadSquadTemplates = useCallback(async () => {
    if (!isCoach || !user?.userId) return;
    setLoadingTemplates(true);
    try {
      const data = await request<{ squadTemplates: SquadTemplateRecord[] }>('/api/coach/squad-templates');
      setSquadTemplates(data.squadTemplates ?? []);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Failed to load squad templates.');
    } finally {
      setLoadingTemplates(false);
    }
  }, [isCoach, request, user?.userId]);

  useEffect(() => {
    loadSessions();
    loadAthletes();
    loadSquadTemplates();
  }, [loadSessions, loadAthletes, loadSquadTemplates]);

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

  const templateToInitialValues = useCallback((template: SquadTemplateRecord) => {
    const preset = ((template.targetPresetJson ?? {}) as Record<string, unknown>) ?? {};
    const visibilityType = preset.visibilityType;
    const selectedDays = Array.isArray(preset.selectedDays)
      ? preset.selectedDays.filter((day): day is string => typeof day === 'string')
      : undefined;
    const targetAthleteIds = Array.isArray(preset.targetAthleteIds)
      ? preset.targetAthleteIds.filter((id): id is string => typeof id === 'string')
      : undefined;

    return {
      title: typeof preset.title === 'string' ? preset.title : '',
      discipline: typeof preset.discipline === 'string' ? preset.discipline : '',
      location: typeof preset.location === 'string' ? preset.location : '',
      startTimeLocal: typeof preset.startTimeLocal === 'string' ? preset.startTimeLocal : '05:30',
      durationMinutes:
        typeof preset.durationMinutes === 'number' && Number.isFinite(preset.durationMinutes)
          ? String(preset.durationMinutes)
          : '60',
      description: typeof preset.description === 'string' ? preset.description : '',
      selectedDays: selectedDays?.length ? selectedDays : ['MO'],
      visibilityType:
        visibilityType === 'ALL' || visibilityType === 'SQUAD' || visibilityType === 'SELECTED' ? visibilityType : 'SQUAD',
      targetAthleteIds: targetAthleteIds ?? [],
      squadInput: template.targets.map((target) => target.squadId).join(', '),
    };
  }, []);

  const createTemplateFromSession = useCallback(
    async (session: GroupSessionRecord) => {
      setTemplateError('');
      const squadIds = session.targets.map((target) => target.squadId).filter((value): value is string => Boolean(value));
      if (!squadIds.length) {
        setTemplateError('Template requires at least one squad target. Set visibility to SQUAD with squad IDs first.');
        return;
      }

      const suggestedName = `${session.title} template`;
      const name = window.prompt('Template name', suggestedName)?.trim();
      if (!name) return;

      try {
        await request('/api/coach/squad-templates', {
          method: 'POST',
          data: {
            name,
            description: session.description ?? null,
            targetSquadIds: Array.from(new Set(squadIds)),
            targetPresetJson: {
              title: session.title,
              discipline: session.discipline,
              location: session.location ?? '',
              startTimeLocal: session.startTimeLocal,
              durationMinutes: session.durationMinutes,
              description: session.description ?? '',
              visibilityType: session.visibilityType,
              selectedDays: parseRuleDays(session.recurrenceRule),
              targetAthleteIds: session.targets
                .map((target) => target.athleteId)
                .filter((value): value is string => Boolean(value)),
            },
          },
        });
        setStatusMessage(`Saved template "${name}".`);
        await loadSquadTemplates();
      } catch (error) {
        setTemplateError(error instanceof Error ? error.message : 'Failed to save template.');
      }
    },
    [loadSquadTemplates, request]
  );

  const handleApplyTemplateToCreate = useCallback(() => {
    setTemplateError('');
    const template = squadTemplates.find((item) => item.id === selectedTemplateId);
    if (!template) {
      setTemplateError('Select a template first.');
      return;
    }

    setCreateInitialValues(templateToInitialValues(template));
    setSelectedSessionId(null);
    setIsCreateModalOpen(true);
  }, [selectedTemplateId, squadTemplates, templateToInitialValues]);

  const handleDeleteTemplate = useCallback(
    async (templateId: string) => {
      if (!confirm('Delete this squad template?')) return;
      setTemplateError('');
      try {
        await request(`/api/coach/squad-templates/${templateId}`, {
          method: 'DELETE',
        });
        if (selectedTemplateId === templateId) {
          setSelectedTemplateId('');
        }
        setStatusMessage('Deleted squad template.');
        await loadSquadTemplates();
      } catch (error) {
        setTemplateError(error instanceof Error ? error.message : 'Failed to delete template.');
      }
    },
    [loadSquadTemplates, request, selectedTemplateId]
  );

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
        {templateError && <p className="mt-3 text-sm text-rose-500">{templateError}</p>}
        {loadingSessions && <p className="mt-3 text-sm text-[var(--muted)]">Loading sessions...</p>}
        {loadingTemplates && <p className="mt-3 text-sm text-[var(--muted)]">Loading templates...</p>}

        <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="flex-1 text-sm font-medium text-[var(--muted)]">
              Squad template
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                className="mt-2 min-h-[44px] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text)]"
              >
                <option value="">Select template...</option>
                {squadTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="secondary" className="min-h-[44px]" onClick={handleApplyTemplateToCreate}>
              Apply to new session
            </Button>
            {selectedTemplateId ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px]"
                onClick={() => void handleDeleteTemplate(selectedTemplateId)}
              >
                Delete template
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Save current session settings as reusable squad templates, then apply defaults when creating new sessions.
          </p>
        </div>
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
              templates={squadTemplates}
              onSaveAsTemplate={createTemplateFromSession}
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
