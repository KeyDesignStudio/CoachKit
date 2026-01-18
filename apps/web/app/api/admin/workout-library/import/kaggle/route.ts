import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibrarySource } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { failure, handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';
import { deriveIntensityCategory } from '@/lib/workout-library-taxonomy';
import { computeWorkoutLibraryFingerprint } from '@/lib/workout-library-fingerprint';
import { fetchKaggleRows, normalizeKaggleRows } from '@/lib/ingestion/kaggle';

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
  scanned: number;
  valid: number;
  wouldCreate: number;
  createdCount: number;
  createdIds: string[];
  skippedExistingCount: number;
  skippedDuplicateInBatchCount: number;
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
  try {
    const { user } = await requireWorkoutLibraryAdmin();

    const body = bodySchema.parse(await request.json());

    if (!body.dryRun && !body.confirmApply) {
      return failure('CONFIRM_APPLY_REQUIRED', 'confirmApply is required when dryRun=false.', 400);
    }

    const rows = body.items && body.items.length > 0 ? body.items : await fetchKaggleRows();

    const normalized = normalizeKaggleRows(rows, body.maxRows, body.offset);

    if (!body.dryRun && normalized.errors.length > 0) {
      const blocked: KaggleImportSummary = {
        source: 'KAGGLE',
        dryRun: body.dryRun,
        scanned: Math.min(Math.max(0, rows.length - body.offset), body.maxRows),
        valid: normalized.items.length,
        wouldCreate: 0,
        createdCount: 0,
        createdIds: [],
        skippedExistingCount: 0,
        skippedDuplicateInBatchCount: 0,
        errorCount: normalized.errors.length,
        errors: normalized.errors,
        sample: { creates: [], skips: [] },
        message: 'Import blocked: fix row errors, then retry.',
      };
      return success(blocked);
    }

    const candidates = normalized.items.map((item) => {
      const fingerprint = computeWorkoutLibraryFingerprint({
        discipline: item.discipline,
        title: item.title,
        durationSec: item.durationSec ?? 0,
        distanceMeters: item.distanceMeters ?? null,
        intensityTarget: item.intensityTarget,
        workoutStructure: item.workoutStructure ?? null,
      });

      return { item, fingerprint };
    });

    // De-dupe within the batch by fingerprint.
    const seen = new Set<string>();
    const unique: typeof candidates = [];
    let skippedDuplicateInBatchCount = 0;
    for (const c of candidates) {
      if (seen.has(c.fingerprint)) {
        skippedDuplicateInBatchCount++;
        continue;
      }
      seen.add(c.fingerprint);
      unique.push(c);
    }

    // Find existing fingerprints.
    const fingerprints = unique.map((c) => c.fingerprint);
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

    const toCreate = unique.filter((c) => !existing.has(c.fingerprint));

    const sampleCreates = toCreate.slice(0, 10).map((c) => ({ title: c.item.title, fingerprint: c.fingerprint }));
    const sampleSkips = unique
      .filter((c) => existing.has(c.fingerprint))
      .slice(0, 10)
      .map((c) => ({ title: c.item.title, fingerprint: c.fingerprint, reason: 'existing fingerprint' }));

    if (body.dryRun) {
      const summary: KaggleImportSummary = {
        source: 'KAGGLE',
        dryRun: true,
        scanned: Math.min(Math.max(0, rows.length - body.offset), body.maxRows),
        valid: normalized.items.length,
        wouldCreate: toCreate.length,
        createdCount: 0,
        createdIds: [],
        skippedExistingCount: unique.length - toCreate.length,
        skippedDuplicateInBatchCount,
        errorCount: normalized.errors.length,
        errors: normalized.errors,
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
              distanceMeters: c.item.distanceMeters ?? null,
              elevationGainMeters: c.item.elevationGainMeters ?? null,
              notes: c.item.notes ?? null,
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
      scanned: Math.min(Math.max(0, rows.length - body.offset), body.maxRows),
      valid: normalized.items.length,
      wouldCreate: toCreate.length,
      createdCount: createdIds.length,
      createdIds,
      skippedExistingCount: unique.length - toCreate.length,
      skippedDuplicateInBatchCount,
      errorCount: normalized.errors.length,
      errors: normalized.errors,
      sample: {
        creates: sampleCreates,
        skips: sampleSkips,
      },
    };

    return success(summary);
  } catch (error) {
    return handleError(error);
  }
}
