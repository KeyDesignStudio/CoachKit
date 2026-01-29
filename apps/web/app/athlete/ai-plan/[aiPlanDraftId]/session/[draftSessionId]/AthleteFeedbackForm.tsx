'use client';

import { useState } from 'react';

type SubmitState = 'idle' | 'saving' | 'saved' | 'error';

export function AthleteFeedbackForm(props: { aiPlanDraftId: string; draftSessionId: string }) {
  const [completedStatus, setCompletedStatus] = useState<'DONE' | 'PARTIAL' | 'SKIPPED'>('DONE');
  const [rpe, setRpe] = useState<string>('');
  const [feel, setFeel] = useState<string>('');
  const [sorenessFlag, setSorenessFlag] = useState<boolean>(false);
  const [sorenessNotes, setSorenessNotes] = useState<string>('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);

  async function onSubmit() {
    setSubmitState('saving');
    setErrorText(null);

    try {
      const res = await fetch('/api/athlete/ai-plan/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          aiPlanDraftId: props.aiPlanDraftId,
          draftSessionId: props.draftSessionId,
          completedStatus,
          rpe: rpe === '' ? null : Number(rpe),
          feel: feel === '' ? null : feel,
          sorenessFlag,
          sorenessNotes: sorenessNotes === '' ? null : sorenessNotes,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Request failed (${res.status})`);
      }

      setSubmitState('saved');
    } catch (e) {
      setSubmitState('error');
      setErrorText(String(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <div className="font-medium">Completed</div>
          <select
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2"
            value={completedStatus}
            onChange={(e) => setCompletedStatus(e.target.value as any)}
            data-testid="athlete-feedback-completed"
          >
            <option value="DONE">Done</option>
            <option value="PARTIAL">Partial</option>
            <option value="SKIPPED">Skipped</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <div className="font-medium">RPE (0–10)</div>
          <input
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2"
            inputMode="numeric"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            placeholder=""
            data-testid="athlete-feedback-rpe"
          />
        </label>

        <label className="space-y-1 text-sm">
          <div className="font-medium">Feel</div>
          <select
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2"
            value={feel}
            onChange={(e) => setFeel(e.target.value)}
            data-testid="athlete-feedback-feel"
          >
            <option value="">—</option>
            <option value="EASY">Easy</option>
            <option value="OK">OK</option>
            <option value="HARD">Hard</option>
            <option value="TOO_HARD">Too hard</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sorenessFlag}
            onChange={(e) => setSorenessFlag(e.target.checked)}
            data-testid="athlete-feedback-soreness-flag"
          />
          <span className="font-medium">Soreness</span>
        </label>
      </div>

      <label className="space-y-1 text-sm">
        <div className="font-medium">Soreness notes</div>
        <textarea
          className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2"
          value={sorenessNotes}
          onChange={(e) => setSorenessNotes(e.target.value)}
          rows={3}
          data-testid="athlete-feedback-soreness-notes"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-[var(--bg-action)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={submitState === 'saving'}
          onClick={onSubmit}
          data-testid="athlete-feedback-submit"
        >
          {submitState === 'saving' ? 'Saving…' : 'Save feedback'}
        </button>

        {submitState === 'saved' && <div className="text-sm text-[var(--fg-muted)]">Saved.</div>}
        {submitState === 'error' && (
          <div className="text-sm text-red-700" data-testid="athlete-feedback-error">
            {errorText}
          </div>
        )}
      </div>
    </div>
  );
}
