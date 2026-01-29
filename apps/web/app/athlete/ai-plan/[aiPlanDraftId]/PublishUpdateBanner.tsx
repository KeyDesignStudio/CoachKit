'use client';

import { useEffect, useState } from 'react';

import { useApi, ApiClientError } from '@/components/api-client';

type PublishStatus = {
  publishedAt: string | null;
  lastPublishedHash: string | null;
  lastPublishedSummaryText: string | null;
  athleteLastSeenHash: string | null;
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
    </div>
  );
}
