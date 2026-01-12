type ProfilePoint = { label: string; ms: number };

export function isApiProfilingEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.COACHKIT_PROFILE_API === '1';
}

export function createServerProfiler(name: string) {
  const enabled = isApiProfilingEnabled();
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const points: ProfilePoint[] = [];

  function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  return {
    enabled,
    mark(label: string) {
      if (!enabled) return;
      points.push({ label, ms: nowMs() - startedAt });
    },
    done(meta?: Record<string, unknown>) {
      if (!enabled) return;
      const totalMs = nowMs() - startedAt;
      // Keep logs compact and grep-friendly.
      console.log(`[api-prof] ${name} total=${totalMs.toFixed(1)}ms`, {
        points,
        ...(meta ? { meta } : {}),
      });
    },
  };
}
