
export function asStructureSegments(structure: unknown): Array<Record<string, unknown>> | null {
  if (!structure) return null;
  if (Array.isArray(structure)) {
    return structure.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object');
  }

  if (typeof structure === 'object') {
    const maybe = structure as Record<string, unknown>;
    // FIX: User requires 'steps_json' as the canonical source.
    // We also support 'steps', 'segments' for fallback/legacy compatibility if steps_json is missing,
    // but priority is steps_json -> steps -> segments.
    const candidates = [maybe.steps_json, maybe.steps, maybe.segments, maybe.intervals];
    
    for (const candidate of candidates) {
       if (Array.isArray(candidate)) {
         return candidate.filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object');
       }
    }
  }

  return null;
}

export function segmentLabel(segment: Record<string, unknown>): string {
  const label = typeof segment.label === 'string' ? segment.label.trim() : '';
  const name = typeof segment.name === 'string' ? segment.name.trim() : '';
  const title = typeof segment.title === 'string' ? segment.title.trim() : '';
  const kind = typeof segment.type === 'string' ? segment.type.trim() : '';
  return label || name || title || kind || 'Segment';
}

export function formatDurationMinutes(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '';
  const minutes = Math.round(durationSec / 60);
  return `${minutes} min`;
}

export function formatDistance(distanceMeters: number | null): string {
  if (!distanceMeters || !Number.isFinite(distanceMeters) || distanceMeters <= 0) return '';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export function segmentMeta(segment: Record<string, unknown>): string {
  const durationSec = typeof segment.durationSec === 'number' ? segment.durationSec : null;
  const distanceMeters = typeof segment.distanceMeters === 'number' ? segment.distanceMeters : null;
  const reps = typeof segment.reps === 'number' ? segment.reps : null;
  const intensity = typeof segment.intensity === 'string' ? segment.intensity.trim() : '';

  const parts: string[] = [];
  if (typeof reps === 'number' && Number.isFinite(reps) && reps > 1) parts.push(`${reps}x`);
  if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) parts.push(formatDurationMinutes(durationSec));
  const dist = formatDistance(distanceMeters);
  if (dist) parts.push(dist);
  if (intensity) parts.push(intensity);
  return parts.join(' · ');
}
