'use client';

import { useEffect, useState } from 'react';

import { useApi, ApiClientError } from '@/components/api-client';

type PublishStatus = {
  publishedAt: string | null;
  lastPublishedHash: string | null;
  lastPublishedSummaryText: string | null;
  athleteLastSeenHash: string | null;
};

type ChangesPayload = {
  lastPublishedAt: string | null;
  lastPublishedSummaryText: string | null;
  athleteLastSeenPublishedHash: string | null;
  audits: Array<{ createdAt: string; changeSummaryText: string }>;
};

export function PublishUpdateBanner(props: {
  aiPlanDraftId: string;
  initialLastPublishedSummaryText: string | null;
}) {
  const { request } = useApi();
  const [status, setStatus] = useState<PublishStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [ackBusy, setAckBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changes, setChanges] = useState<ChangesPayload | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await request<{ publishStatus: PublishStatus }>(
          `/api/athlete/ai-plan/publish-status?aiPlanDraftId=${encodeURIComponent(props.aiPlanDraftId)}`
        );
        if (cancelled) return;
        setStatus(res.publishStatus);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setError(`${e.code}: ${e.message}`);
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load publish status.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.aiPlanDraftId, request]);

  const lastPublishedHash = status?.lastPublishedHash ?? null;
  const athleteLastSeenHash = status?.athleteLastSeenHash ?? null;
  const show = Boolean(lastPublishedHash && lastPublishedHash !== athleteLastSeenHash);

  if (loading) return null;
  if (!show) return null;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">Plan updated</div>
          <div className="mt-1 text-[var(--fg-muted)]">
            {status?.lastPublishedSummaryText ?? props.initialLastPublishedSummaryText ?? 'No changes'}
          </div>
          {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
          <button
            type="button"
            className="mt-2 text-xs text-[var(--fg-muted)] underline hover:text-[var(--fg)]"
            data-testid="athlete-view-changes"
            onClick={async () => {
              const nextOpen = !changesOpen;
              setChangesOpen(nextOpen);
              if (!nextOpen) return;
              if (changes) return;
              setChangesLoading(true);
              setError(null);
              try {
                const res = await request<{ changes: ChangesPayload }>(
                  `/api/athlete/ai-plan/changes?aiPlanDraftId=${encodeURIComponent(props.aiPlanDraftId)}&limit=10`
                );
                setChanges(res.changes);
              } catch (e) {
                if (e instanceof ApiClientError) {
                  setError(`${e.code}: ${e.message}`);
                } else {
                  setError(e instanceof Error ? e.message : 'Failed to load changes.');
                }
              } finally {
                setChangesLoading(false);
              }
            }}
          >
            View changes
          </button>
        </div>

        <button
          type="button"
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1 text-xs hover:bg-[var(--bg-element-hover)]"
          disabled={ackBusy || !lastPublishedHash}
          onClick={async () => {
            if (!lastPublishedHash) return;
            setAckBusy(true);
            setError(null);
            try {
              await request<{ ack: { lastSeenPublishedHash: string; lastSeenAt: string } }>(
                '/api/athlete/ai-plan/publish-ack',
                {
                  method: 'POST',
                  data: { aiPlanDraftId: props.aiPlanDraftId, lastSeenPublishedHash: lastPublishedHash },
                }
              );
              setStatus((prev) =>
                prev
                  ? { ...prev, athleteLastSeenHash: lastPublishedHash }
                  : { publishedAt: null, lastPublishedHash, lastPublishedSummaryText: null, athleteLastSeenHash: lastPublishedHash }
              );
            } catch (e) {
              if (e instanceof ApiClientError) {
                setError(`${e.code}: ${e.message}`);
              } else {
                setError(e instanceof Error ? e.message : 'Failed to acknowledge update.');
              }
            } finally {
              setAckBusy(false);
            }
          }}
        >
          Got it
        </button>
      </div>

      {changesOpen && (
        <div
          className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2"
          data-testid="athlete-changes-panel"
        >
          <div className="text-xs font-medium">What changed</div>

          {changesLoading ? (
            <div className="mt-2 text-xs text-[var(--fg-muted)]">Loading…</div>
          ) : (
            <>
              <div className="mt-2 text-xs text-[var(--fg-muted)]">{changes?.lastPublishedSummaryText ?? '—'}</div>

              <div className="mt-3 text-xs font-medium">Recent updates</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-[var(--fg-muted)]">
                {(changes?.audits ?? []).length === 0 ? (
                  <li>No updates since you last acknowledged.</li>
                ) : (
                  (changes?.audits ?? []).map((a, idx) => (
                    <li key={idx} data-testid="athlete-change-audit">
                      {a.changeSummaryText}
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
