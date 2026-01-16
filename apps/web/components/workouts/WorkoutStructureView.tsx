'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

function asSegmentArray(structure: unknown): Array<Record<string, unknown>> | null {
  if (!structure) return null;

  if (Array.isArray(structure)) {
    return structure.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object') as Array<Record<string, unknown>>;
  }

  if (typeof structure === 'object') {
    const rec = structure as Record<string, unknown>;
    const maybeSegments = rec.segments ?? rec.intervals ?? rec.steps;
    if (Array.isArray(maybeSegments)) {
      return maybeSegments.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object') as Array<Record<string, unknown>>;
    }
  }

  return null;
}

function segmentLabel(seg: Record<string, unknown>): string {
  const candidates = [seg.label, seg.title, seg.name, seg.type, seg.kind];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return 'Segment';
}

function formatNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return String(Number(value));
  return null;
}

function segmentMeta(seg: Record<string, unknown>): string {
  const parts: string[] = [];

  const durationSec = formatNumber(seg.durationSec ?? seg.durationSeconds ?? seg.duration_s);
  const durationMin = formatNumber(seg.durationMinutes ?? seg.durationMin ?? seg.minutes);
  const distanceM = formatNumber(seg.distanceMeters ?? seg.distanceM ?? seg.distance_m);
  const distanceKm = formatNumber(seg.distanceKm ?? seg.km);
  const reps = formatNumber(seg.reps ?? seg.repeat ?? seg.repetitions);

  if (reps) parts.push(`${reps}×`);

  if (durationMin) parts.push(`${durationMin} min`);
  else if (durationSec) parts.push(`${durationSec} sec`);

  if (distanceKm) parts.push(`${distanceKm} km`);
  else if (distanceM) parts.push(`${distanceM} m`);

  const intensity = [seg.intensity, seg.intensityTarget, seg.target, seg.power, seg.pace, seg.hr]
    .map((v) => (typeof v === 'string' ? v.trim() : null))
    .find(Boolean);
  if (intensity) parts.push(intensity);

  return parts.join(' · ');
}

export function WorkoutStructureView({ structure, className }: { structure: unknown; className?: string }) {
  const [showJson, setShowJson] = useState(false);

  const segments = useMemo(() => asSegmentArray(structure), [structure]);
  const hasStructure = structure !== null && structure !== undefined;

  if (!hasStructure) return null;

  const jsonText = (() => {
    try {
      return JSON.stringify(structure, null, 2);
    } catch {
      return String(structure);
    }
  })();

  return (
    <div className={cn('space-y-3', className)}>
      {segments && segments.length ? (
        <ol className="space-y-2">
          {segments.map((seg, index) => {
            const label = segmentLabel(seg);
            const meta = segmentMeta(seg);
            const notes = typeof seg.notes === 'string' ? seg.notes.trim() : '';

            return (
              <li key={index} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--text)] break-words">{label}</div>
                    {meta ? <div className="mt-0.5 text-xs text-[var(--muted)] break-words">{meta}</div> : null}
                  </div>
                </div>
                {notes ? <div className="mt-2 text-sm text-[var(--text)] whitespace-pre-wrap break-words">{notes}</div> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="text-sm text-[var(--muted)]">Structure data present.</div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => setShowJson((v) => !v)} className="min-h-[40px]">
          {showJson ? 'Hide JSON' : 'View JSON'}
        </Button>
      </div>

      {showJson ? (
        <pre className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs text-[var(--text)] whitespace-pre-wrap break-words">
          {jsonText}
        </pre>
      ) : null}
    </div>
  );
}
