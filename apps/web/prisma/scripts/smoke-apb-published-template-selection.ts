/**
 * Smoke check: APB selection JSON must reference published templates only.
 *
 * Run (from repo root):
 *   cd /Volumes/DockSSD/Projects/CoachKit
 *   export DATABASE_URL='postgresql://...'
 *   npx --prefix apps/web ts-node --project apps/web/tsconfig.prisma.json \
 *     apps/web/prisma/scripts/smoke-apb-published-template-selection.ts
 *
 * Optional:
 *   export SMOKE_COACH_ID='user-coach-multisport'
 *   export SMOKE_ATHLETE_ID='user-athlete-one'
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const COACH_ID = process.env.SMOKE_COACH_ID || 'user-coach-multisport';
const ATHLETE_ID = process.env.SMOKE_ATHLETE_ID || 'user-athlete-one';

type SelectionJson = {
  selectedPlanSourceVersionIds?: string[];
  selectedPlanSources?: Array<{
    planSourceVersionId?: string;
    title?: string;
  }>;
};

async function main() {
  console.log('[smoke-apb-published-template-selection] Checking latest APB draft selection...');

  const draft = await prisma.aiPlanDraft.findFirst({
    where: {
      coachId: COACH_ID,
      athleteId: ATHLETE_ID,
      source: 'AI_DRAFT',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      planSourceSelectionJson: true,
    },
  });

  if (!draft) {
    console.log('No AI draft found for this coach/athlete. Generate one draft first, then rerun this smoke check.');
    return;
  }

  const selection = (draft.planSourceSelectionJson ?? {}) as SelectionJson;
  const selectedIds = Array.from(
    new Set(
      [
        ...(Array.isArray(selection.selectedPlanSourceVersionIds) ? selection.selectedPlanSourceVersionIds : []),
        ...(Array.isArray(selection.selectedPlanSources)
          ? selection.selectedPlanSources
              .map((entry) => String(entry?.planSourceVersionId ?? '').trim())
              .filter(Boolean)
          : []),
      ].filter(Boolean)
    )
  );

  console.log(`Draft ID: ${draft.id}`);
  console.log(`Created:  ${draft.createdAt.toISOString()}`);
  console.log(`Selected template IDs: ${selectedIds.join(', ') || '(none)'}`);

  if (!selectedIds.length) {
    console.log('No selected template IDs were recorded; nothing to validate.');
    return;
  }

  const rows = await prisma.planLibraryTemplate.findMany({
    where: { id: { in: selectedIds } },
    select: { id: true, title: true, isPublished: true, reviewStatus: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const missing = selectedIds.filter((id) => !byId.has(id));
  const unpublished = rows.filter((row) => !row.isPublished);

  if (missing.length) {
    console.error(`FAIL: ${missing.length} selected IDs do not exist in PlanLibraryTemplate.`);
    missing.forEach((id) => console.error(`  missing: ${id}`));
    process.exitCode = 1;
    return;
  }

  if (unpublished.length) {
    console.error(`FAIL: ${unpublished.length} selected templates are not published.`);
    unpublished.forEach((row) => console.error(`  ${row.id} | ${row.title} | ${row.reviewStatus}`));
    process.exitCode = 1;
    return;
  }

  console.log('PASS: all selected template IDs resolve to published PlanLibraryTemplate records.');
  rows.forEach((row) => {
    console.log(`  ${row.id} | ${row.title} | published=${row.isPublished}`);
  });
}

main()
  .catch((error) => {
    console.error('[smoke-apb-published-template-selection] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
