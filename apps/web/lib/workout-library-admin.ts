import { forbidden } from '@/lib/errors';
import { requireCoach } from '@/lib/auth';

function parseEmailAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function requireWorkoutLibraryAdmin() {
  const ctx = await requireCoach();

  // In dev with auth disabled, allow all coaches to hit admin routes.
  // This is helpful for local iteration and does not apply in production.
  if (
    process.env.NODE_ENV === 'development' &&
    (process.env.DISABLE_AUTH === 'true' || process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true')
  ) {
    return ctx;
  }

  // Phase 2: allowlist-based admin gating (no isAdmin flag in schema yet).
  const allowlist = parseEmailAllowlist(process.env.WORKOUT_LIBRARY_ADMIN_EMAILS);

  if (allowlist.size === 0) {
    throw forbidden('Admin access required.');
  }

  if (!allowlist.has(ctx.user.email.toLowerCase())) {
    throw forbidden('Admin access required.');
  }

  return ctx;
}
