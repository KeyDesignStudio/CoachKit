import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WorkoutLibraryDiscipline } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { handleError, success } from '@/lib/http';
import { requireWorkoutLibraryAdmin } from '@/lib/workout-library-admin';

export const dynamic = 'force-dynamic';

function parseNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseCommaList(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function parseWorkoutStructure(raw: unknown): unknown | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Leave as string; validation will reject non-JSON strings if needed.
      return raw;
    }
  }
  return raw;
}

const importRawItemSchema = z
  .object({
    title: z.any(),
    discipline: z.any(),
    tags: z.any().optional(),
    description: z.any(),
    durationSec: z.any().optional(),
    intensityTarget: z.any(),
    distanceMeters: z.any().optional(),
    elevationGainMeters: z.any().optional(),
    notes: z.any().optional(),
    equipment: z.any().optional(),
    workoutStructure: z.any().optional(),
  })
  .transform((raw) => {
    const title = typeof raw.title === 'string' ? raw.title.trim() : String(raw.title ?? '').trim();
    const discipline =
      typeof raw.discipline === 'string'
        ? raw.discipline.trim().toUpperCase()
        : String(raw.discipline ?? '').trim().toUpperCase();
    const description =
      typeof raw.description === 'string'
        ? raw.description.trim()
        : String(raw.description ?? '').trim();
    const intensityTarget =
      typeof raw.intensityTarget === 'string'
        ? raw.intensityTarget.trim()
        : String(raw.intensityTarget ?? '').trim();

    return {
      title,
      discipline,
      tags: parseCommaList(raw.tags),
      description,
      durationSec: parseNumber(raw.durationSec),
      intensityTarget,
      distanceMeters: parseNumber(raw.distanceMeters),
      elevationGainMeters: parseNumber(raw.elevationGainMeters),
      notes: typeof raw.notes === 'string' ? raw.notes.trim() : raw.notes ? String(raw.notes) : undefined,
      equipment: parseCommaList(raw.equipment),
      workoutStructure: parseWorkoutStructure(raw.workoutStructure),
    };
  });

const importItemSchema = z
  .object({
    title: z.string().min(1),
    discipline: z.nativeEnum(WorkoutLibraryDiscipline),
    tags: z.array(z.string().trim().min(1)).default([]),
    description: z.string().min(1),
    durationSec: z.number().int().positive().optional(),
    intensityTarget: z.string().min(1),
    distanceMeters: z.number().positive().optional(),
    elevationGainMeters: z.number().nonnegative().optional(),
    notes: z.string().trim().max(20000).optional(),
    equipment: z.array(z.string().trim().min(1)).default([]),
    workoutStructure: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    const hasDuration = typeof data.durationSec === 'number' && data.durationSec > 0;
    const hasDistance = typeof data.distanceMeters === 'number' && data.distanceMeters > 0;

    if (!hasDuration && !hasDistance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'durationSec or distanceMeters is required.',
      });
    }
  });

const importBodySchema = z.object({
  dryRun: z.boolean().default(true),
  items: z.array(z.unknown()).default([]),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireWorkoutLibraryAdmin();

    const parsedBody = importBodySchema.parse(await request.json());
    const dryRun = parsedBody.dryRun;

    if (parsedBody.items.length === 0) {
      return success({
        dryRun,
        totalCount: 0,
        validCount: 0,
        errorCount: 0,
        preview: [],
        errors: [],
        createdCount: 0,
        createdIds: [],
        message: 'No items provided.',
      });
    }

    const normalized: Array<z.infer<typeof importItemSchema>> = [];
    const errors: Array<{ index: number; message: string }> = [];

    for (let i = 0; i < parsedBody.items.length; i++) {
      const raw = parsedBody.items[i];
      const rawParsed = importRawItemSchema.safeParse(raw);
      if (!rawParsed.success) {
        errors.push({ index: i + 1, message: 'Invalid row shape.' });
        continue;
      }

      const coerced = {
        ...rawParsed.data,
        discipline: rawParsed.data.discipline as unknown,
      };

      const candidate = importItemSchema.safeParse(coerced);
      if (!candidate.success) {
        const message = candidate.error.issues[0]?.message ?? 'Validation error.';
        errors.push({ index: i + 1, message });
        continue;
      }

      normalized.push(candidate.data);
    }

    const preview = normalized.slice(0, 20);

    if (!dryRun && errors.length > 0) {
      return success({
        dryRun,
        totalCount: parsedBody.items.length,
        validCount: normalized.length,
        errorCount: errors.length,
        preview,
        errors,
        createdCount: 0,
        createdIds: [],
        message: 'Import blocked: fix row errors, then retry.',
      });
    }

    if (dryRun) {
      return success({
        dryRun,
        totalCount: parsedBody.items.length,
        validCount: normalized.length,
        errorCount: errors.length,
        preview,
        errors,
        createdCount: 0,
        createdIds: [],
      });
    }

    const created = await prisma.$transaction(
      normalized.map((item) =>
        prisma.workoutLibrarySession.create({
          data: {
            title: item.title,
            discipline: item.discipline,
            tags: item.tags,
            description: item.description,
            durationSec: item.durationSec ?? 0,
            intensityTarget: item.intensityTarget,
            distanceMeters: item.distanceMeters ?? null,
            elevationGainMeters: item.elevationGainMeters ?? null,
            notes: item.notes ?? null,
            equipment: item.equipment,
            workoutStructure: item.workoutStructure ?? undefined,
            createdByUserId: user.id,
          },
          select: { id: true },
        })
      )
    );

    return success({
      dryRun,
      totalCount: parsedBody.items.length,
      validCount: normalized.length,
      errorCount: errors.length,
      preview,
      errors,
      createdCount: created.length,
      createdIds: created.map((c) => c.id),
    });
  } catch (error) {
    return handleError(error);
  }
}
