/**
 * ADMIN/ONE-OFF – cleanup legacy STRAVA notes
 *
 * Goal:
 * - For STRAVA CompletedActivity rows where `notes` was incorrectly set to the Strava activity name,
 *   clear it by setting `notes = null`.
 *
 * Safety:
 * - Only clears notes when notes EXACTLY equals metricsJson.strava.activityName OR metricsJson.strava.name
 * - Does not touch notes if athlete modified it (notes != activity name)
 * - Requires explicit confirmation via env var
 * - Supports DRY_RUN (default true)
 *
 * Run (from repo root):
 *   export DATABASE_URL='postgresql://...'
 *   export CONFIRM_STRAVA_NOTES_CLEANUP='YES'
 *   export DRY_RUN='true'   # default
 *   # export LIMIT='500'     # optional
 *   npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json \
 *     apps/web/prisma/scripts/cleanup-strava-notes-equal-activity-name.ts
 */

import { CompletionSource, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const limit = (() => {
  const raw = process.env.LIMIT;
  if (!raw) return 500;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 500;
  return Math.min(5000, Math.floor(n));
})();

const dryRun = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function getStravaName(metricsJson: unknown): string | null {
  if (!metricsJson || typeof metricsJson !== 'object') return null;
  const mj: any = metricsJson;
  const s = mj?.strava;
  const name = s?.activityName ?? s?.name;
  return typeof name === 'string' && name.length ? name : null;
}

async function main() {
  if (process.env.CONFIRM_STRAVA_NOTES_CLEANUP !== 'YES') {
    throw new Error('Refusing to run without CONFIRM_STRAVA_NOTES_CLEANUP=YES.');
  }

  console.log('[cleanup-strava-notes] Starting', { limit, dryRun });

  const candidates = await prisma.completedActivity.findMany({
    where: {
      source: CompletionSource.STRAVA,
      notes: { not: null },
    },
    select: {
      id: true,
      notes: true,
      metricsJson: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  let matching = 0;
  const toNull: string[] = [];

  for (const row of candidates) {
    const notes = row.notes;
    if (!notes) continue;

    const activityName = getStravaName(row.metricsJson);
    if (!activityName) continue;

    if (notes === activityName) {
      matching += 1;
      toNull.push(row.id);
    }
  }

  console.log('[cleanup-strava-notes] Scanned', { candidates: candidates.length, matching });

  if (dryRun) {
    console.log('[cleanup-strava-notes] DRY_RUN=true; no changes applied.');
    return;
  }

  let updated = 0;

  for (const id of toNull) {
    await prisma.completedActivity.update({
      where: { id },
      data: { notes: null },
    });
    updated += 1;
  }

  console.log('[cleanup-strava-notes] Done', { updated });
}

main()
  .catch((err) => {
    console.error('[cleanup-strava-notes] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
