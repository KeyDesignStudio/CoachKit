'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useApi } from '@/components/api-client';
import { useAuthUser } from '@/components/use-auth-user';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Block } from '@/components/ui/Block';
import { uiEyebrow, uiH1, uiMuted } from '@/components/ui/typography';

import { INTAKE_SECTIONS, type IntakeQuestion } from '@/modules/athlete-intake/questions';

const STORAGE_KEY = 'athlete-intake-draft-v1';

type AnswerMap = Record<string, unknown>;

type IntakeDraft = {
  version: string;
  answers: AnswerMap;
};

function loadDraft(): IntakeDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IntakeDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.answers || typeof parsed.answers !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(draft: IntakeDraft) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // no-op
  }
}

function emptyDraft(): IntakeDraft {
  return { version: 'v1', answers: {} };
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normalizeNumber(value: string, min?: number, max?: number): number | '' {
  if (!value.trim()) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const clamped = Math.max(min ?? n, Math.min(max ?? n, n));
  return clamped;
}

function renderQuestion(
  question: IntakeQuestion,
  value: unknown,
  onChange: (next: unknown) => void
) {
  if (question.type === 'textarea') {
    return (
      <Textarea
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
      />
    );
  }

  if (question.type === 'select') {
    return (
      <Select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {(question.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </Select>
    );
  }

  if (question.type === 'multi') {
    const current = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="grid grid-cols-2 gap-2">
        {(question.options ?? []).map((opt) => {
          const checked = current.includes(opt);
          return (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? Array.from(new Set([...current, opt]))
                    : current.filter((v) => v !== opt);
                  onChange(next);
                }}
              />
              {opt}
            </label>
          );
        })}
      </div>
    );
  }

  if (question.type === 'scale') {
    const min = question.min ?? 1;
    const max = question.max ?? 5;
    const options = Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
    return (
      <Select value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="">Select…</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </Select>
    );
  }

  if (question.type === 'number') {
    return (
      <Input
        type="number"
        min={question.min}
        max={question.max}
        value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
        onChange={(e) => onChange(normalizeNumber(e.target.value, question.min, question.max))}
      />
    );
  }

  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function AthleteIntakePage() {
  const { request } = useApi();
  const { user, loading: userLoading } = useAuthUser();
  const router = useRouter();

  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const draft = loadDraft();
    if (draft?.answers) setAnswers(draft.answers);
  }, []);

  useEffect(() => {
    saveDraft({ version: 'v1', answers });
  }, [answers]);

  const section = INTAKE_SECTIONS[sectionIndex];
  const progress = useMemo(() => ((sectionIndex + 1) / INTAKE_SECTIONS.length) * 100, [sectionIndex]);

  if (userLoading) {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Loading…</p>
      </div>
    );
  }

  if (!user || user.role !== 'ATHLETE') {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Athlete access required.</p>
      </div>
    );
  }

  const onSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        version: 'v1',
        sections: INTAKE_SECTIONS.map((s) => ({
          key: s.key,
          title: s.title,
          answers: s.questions
            .map((q) => ({ questionKey: q.key, answer: answers[q.key] ?? null }))
            .filter((a) => !isEmptyValue(a.answer)),
        })),
      };

      await request('/api/athlete/intake/submit', {
        method: 'POST',
        data: payload,
      });

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY);
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit intake.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!section) {
    return (
      <div className="px-6 pt-6">
        <p className="text-[var(--muted)]">Intake unavailable.</p>
      </div>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="space-y-2">
        <p className={uiEyebrow}>Coaching Intake</p>
        <h1 className={uiH1}>Athlete Intake</h1>
        <p className={uiMuted}>Answer in your own words — this shapes your coaching plan.</p>
      </header>

      <div className="h-2 w-full rounded-full bg-[var(--bg-structure)]">
        <div className="h-full rounded-full bg-[var(--fg)]" style={{ width: `${progress}%` }} />
      </div>

      <Block title={`${sectionIndex + 1}. ${section.title}`}>
        <div className="space-y-4">
          {section.intro ? <p className="text-sm text-[var(--muted)]">{section.intro}</p> : null}

          {section.questions.map((question) => (
            <label key={question.key} className="flex flex-col gap-2 text-sm font-medium text-[var(--muted)]">
              {question.prompt}
              {renderQuestion(question, answers[question.key], (next) =>
                setAnswers((prev) => ({ ...prev, [question.key]: next }))
              )}
            </label>
          ))}
        </div>
      </Block>

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      {submitted ? (
        <Block title="Thanks — you’re all set">
          <div className="space-y-3 text-sm">
            <p>Your coach now has a concise Athlete Brief to guide your plan.</p>
            <Button type="button" onClick={() => router.push('/athlete/calendar')} className="min-h-[44px]">
              Continue to training
            </Button>
          </div>
        </Block>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setSectionIndex((prev) => Math.max(0, prev - 1))}
            disabled={sectionIndex === 0 || submitting}
            className="min-h-[44px]"
          >
            Back
          </Button>
          {sectionIndex < INTAKE_SECTIONS.length - 1 ? (
            <Button type="button" onClick={() => setSectionIndex((prev) => Math.min(INTAKE_SECTIONS.length - 1, prev + 1))} className="min-h-[44px]">
              Next section
            </Button>
          ) : (
            <Button type="button" onClick={onSubmit} disabled={submitting} className="min-h-[44px]">
              {submitting ? 'Submitting…' : 'Submit and continue coaching'}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
