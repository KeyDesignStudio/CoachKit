import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibrarySource } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { failure, handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import { deriveIntensityCategory } from '@/lib/workout-library-taxonomy';
import { computeWorkoutLibraryFingerprint } from '@/lib/workout-library-fingerprint';
import { buildKaggleProgramTemplates, fetchKaggleTable } from '@/lib/ingestion/kaggle';

export const dynamic = 'force-dynamic';

const DEFAULT_MAX_ROWS = 200;
const HARD_MAX_ROWS = 2000;

const bodySchema = z.object({
  dryRun: z.boolean().default(true),
  confirmApply: z.boolean().default(false),
  maxRows: z.number().int().positive().max(HARD_MAX_ROWS).default(DEFAULT_MAX_ROWS),
  offset: z.number().int().min(0).default(0),
  items: z.array(z.unknown()).optional(),
});

type KaggleImportSummary = {
  source: 'KAGGLE';
  dryRun: boolean;
  scannedGroups: number;
  wouldCreate: number;
  wouldUpdate: number;
  createdCount: number;
  updatedCount: number;
  createdIds: string[];
  skippedDuplicates: number;
  skippedInvalidTitle: number;
  errorCount: number;
  errors: Array<{ index: number; message: string }>;
  sample: {
    creates: Array<{ title: string; fingerprint: string }>;
    skips: Array<{ title: string; fingerprint: string; reason: string }>;
  };
  message?: string;
};

function chunk<T>(values: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    result.push(values.slice(i, i + chunkSize));
  }
  return result;
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const { user } = await requireWorkoutLibraryAdmin();

    const body = bodySchema.parse(await request.json());

    if (!body.dryRun && !body.confirmApply) {
      return failure('CONFIRM_APPLY_REQUIRED', 'confirmApply is required when dryRun=false.', 400, requestId);
    }

    const table = body.items && body.items.length > 0
      ? { format: 'json' as const, rows: body.items.map((raw) => (raw && typeof raw === 'object' ? (raw as any) : {})) }
      : await fetchKaggleTable({ requestId });

    const program = buildKaggleProgramTemplates(table.rows, {
      maxGroups: body.maxRows,
      offsetGroups: body.offset,
    });

    if (!body.dryRun && program.summary.errors.length > 0) {
      const blocked: KaggleImportSummary = {
        source: 'KAGGLE',
        dryRun: false,
        scannedGroups: program.summary.scannedGroups,
        wouldCreate: 0,
        wouldUpdate: 0,
        createdCount: 0,
        updatedCount: 0,
        createdIds: [],
        skippedDuplicates: 0,
        skippedInvalidTitle: program.summary.skippedInvalidTitleGroups,
        errorCount: program.summary.errors.length,
        errors: program.summary.errors,
        sample: { creates: [], skips: [] },
        message: 'Import blocked: fix group errors, then retry.',
      };
      return success(blocked);
    }

    const candidates = program.items.map((item) => {
      // Fingerprint is computed on the stable template identity, not the display title.
      const fingerprint = computeWorkoutLibraryFingerprint({
        discipline: item.discipline,
        title: item.titleKey,
        durationSec: item.durationSec ?? 0,
        distanceMeters: null,
        intensityTarget: item.intensityTarget,
        workoutStructure: item.workoutStructure ?? null,
      });

      return { item, fingerprint };
    });

    // Find existing fingerprints.
    const fingerprints = candidates.map((c) => c.fingerprint);
    const existing = new Set<string>();
    for (const batch of chunk(fingerprints, 500)) {
      const rows = await prisma.workoutLibrarySession.findMany({
        where: { fingerprint: { in: batch } },
        select: { fingerprint: true },
      });
      for (const r of rows) {
        if (r.fingerprint) existing.add(r.fingerprint);
      }
    }

    const toCreate = candidates.filter((c) => !existing.has(c.fingerprint));
    const skippedDuplicates = candidates.length - toCreate.length;

    const sampleCreates = toCreate.slice(0, 10).map((c) => ({ title: c.item.title, fingerprint: c.fingerprint }));
    const sampleSkips = candidates
      .filter((c) => existing.has(c.fingerprint))
      .slice(0, 10)
      .map((c) => ({ title: c.item.title, fingerprint: c.fingerprint, reason: 'existing fingerprint' }));

    if (body.dryRun) {
      const summary: KaggleImportSummary = {
        source: 'KAGGLE',
        dryRun: true,
        scannedGroups: program.summary.scannedGroups,
        wouldCreate: toCreate.length,
        wouldUpdate: 0,
        createdCount: 0,
        updatedCount: 0,
        createdIds: [],
        skippedDuplicates,
        skippedInvalidTitle: program.summary.skippedInvalidTitleGroups,
        errorCount: program.summary.errors.length,
        errors: program.summary.errors,
        sample: {
          creates: sampleCreates,
          skips: sampleSkips,
        },
      };

      return success(summary);
    }

    // Apply.
    const createdIds: string[] = [];

    // Chunked transactions to keep request bounded.
    for (const batch of chunk(toCreate, 100)) {
      const created = await prisma.$transaction(
        batch.map((c) =>
          prisma.workoutLibrarySession.create({
            data: {
              title: c.item.title,
              discipline: c.item.discipline,
              status: 'DRAFT',
              source: WorkoutLibrarySource.KAGGLE,
              fingerprint: c.fingerprint,
              tags: c.item.tags,
              description: c.item.description,
              durationSec: c.item.durationSec ?? 0,
              intensityTarget: c.item.intensityTarget,
              intensityCategory: deriveIntensityCategory(c.item.intensityTarget),
              distanceMeters: null,
              elevationGainMeters: null,
              notes: null,
              equipment: c.item.equipment,
              workoutStructure: c.item.workoutStructure ?? undefined,
              createdByUserId: user.id,
            },
            select: { id: true },
          })
        )
      );

      for (const row of created) createdIds.push(row.id);
    }

    const summary: KaggleImportSummary = {
      source: 'KAGGLE',
      dryRun: false,
      scannedGroups: program.summary.scannedGroups,
      wouldCreate: toCreate.length,
      wouldUpdate: 0,
      createdCount: createdIds.length,
      updatedCount: 0,
      createdIds,
      skippedDuplicates,
      skippedInvalidTitle: program.summary.skippedInvalidTitleGroups,
      errorCount: program.summary.errors.length,
      errors: program.summary.errors,
      sample: {
        creates: sampleCreates,
        skips: sampleSkips,
      },
    };

    return success(summary);
  } catch (error) {
    return handleError(error, { requestId, where: 'POST /api/admin/workout-library/import/kaggle' });
  }
}
