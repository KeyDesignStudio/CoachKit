'use client';

import { useEffect, useMemo, useState } from 'react';

export function PublishUpdateBanner(props: {
  aiPlanDraftId: string;
  publishedAtIso: string | null;
  summaryText: string | null;
}) {
  const storageKey = useMemo(() => `ai-plan:lastSeen:${props.aiPlanDraftId}`, [props.aiPlanDraftId]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!props.publishedAtIso) return;

    try {
      const lastSeen = localStorage.getItem(storageKey);
      if (lastSeen) {
        const lastSeenMs = Date.parse(lastSeen);
        const publishedMs = Date.parse(props.publishedAtIso);
        if (Number.isFinite(lastSeenMs) && Number.isFinite(publishedMs) && publishedMs > lastSeenMs) {
          setShow(true);
        }
      }
      localStorage.setItem(storageKey, props.publishedAtIso);
    } catch {
      // ignore storage errors
    }
  }, [props.publishedAtIso, storageKey]);

  if (!show) return null;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-structure)] px-4 py-3 text-sm">
      <div className="font-medium">Plan updated</div>
      <div className="mt-1 text-[var(--fg-muted)]">{props.summaryText || 'No changes'}</div>
    </div>
  );
}
