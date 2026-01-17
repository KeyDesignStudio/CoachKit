import { NextRequest } from 'next/server';
import { Prisma, WorkoutLibraryDiscipline, WorkoutLibraryIntensityCategory, WorkoutLibrarySessionStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireCoach } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { privateCacheHeaders } from '@/lib/cache';

export const dynamic = 'force-dynamic';

type SortKey = 'relevance' | 'newest' | 'popular' | 'durationAsc' | 'durationDesc' | 'intensityAsc' | 'intensityDesc' | 'titleAsc';

function parseSortKey(value: string | null): SortKey {
  const v = (value ?? '').trim();
  switch (v) {
    case 'newest':
    case 'popular':
    case 'durationAsc':
    case 'durationDesc':
    case 'intensityAsc':
    case 'intensityDesc':
    case 'titleAsc':
    case 'relevance':
      return v;
    default:
      return 'relevance';
  }
}

function parseIntensityCategory(value: string | null): WorkoutLibraryIntensityCategory | null {
  const v = (value ?? '').trim().toUpperCase();
  if (!v) return null;
  return Object.values(WorkoutLibraryIntensityCategory).includes(v as WorkoutLibraryIntensityCategory)
    ? (v as WorkoutLibraryIntensityCategory)
    : null;
}

function parseMulti(query: URLSearchParams, key: string): string[] {
  const values = query.getAll(key).flatMap((v) => (v.includes(',') ? v.split(',') : [v]));
  return values.map((v) => v.trim()).filter(Boolean);
}

function parseIntOrNull(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireCoach();

    const { searchParams } = new URL(request.url);

    const q = (searchParams.get('q') ?? '').trim();
    const disciplineRaw = parseMulti(searchParams, 'discipline');
    const tags = parseMulti(searchParams, 'tags');
    const intensityTarget = (searchParams.get('intensityTarget') ?? '').trim();
    const intensityCategory = parseIntensityCategory(searchParams.get('intensityCategory'));
    const sort = parseSortKey(searchParams.get('sort'));
    const favoritesOnlyRaw = (searchParams.get('favoritesOnly') ?? '').trim().toLowerCase();
    const favoritesOnly = favoritesOnlyRaw === '1' || favoritesOnlyRaw === 'true' || favoritesOnlyRaw === 'yes';

    const page = clamp(parseIntOrNull(searchParams.get('page')) ?? 1, 1, 10_000);
    const pageSize = clamp(parseIntOrNull(searchParams.get('pageSize')) ?? 20, 1, 100);

    const durationMin = parseIntOrNull(searchParams.get('durationMin'));
    const durationMax = parseIntOrNull(searchParams.get('durationMax'));

    const discipline = disciplineRaw.filter((d): d is WorkoutLibraryDiscipline =>
      Object.values(WorkoutLibraryDiscipline).includes(d as WorkoutLibraryDiscipline)
    );

    const where: Prisma.WorkoutLibrarySessionWhereInput = {
      status: WorkoutLibrarySessionStatus.PUBLISHED,
      ...(q
        ? {
            title: {
              contains: q,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(discipline.length > 0
        ? {
            discipline: {
              in: discipline,
            },
          }
        : {}),
      ...(tags.length > 0
        ? {
            tags: {
              hasSome: tags,
            },
          }
        : {}),
      ...(typeof durationMin === 'number' || typeof durationMax === 'number'
        ? {
            durationSec: {
              ...(typeof durationMin === 'number' ? { gte: Math.max(0, durationMin) * 60 } : {}),
              ...(typeof durationMax === 'number' ? { lte: Math.max(0, durationMax) * 60 } : {}),
            },
          }
        : {}),
      ...(intensityTarget
        ? {
            intensityTarget: {
              contains: intensityTarget,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(intensityCategory
        ? {
            intensityCategory,
          }
        : {}),
      ...(favoritesOnly
        ? {
            favorites: {
              some: {
                coachId: user.id,
              },
            },
          }
        : {}),
    };

    const orderBy: Prisma.WorkoutLibrarySessionOrderByWithRelationInput[] = (() => {
      switch (sort) {
        case 'newest':
          return [{ createdAt: 'desc' }];
        case 'popular':
          return [{ usage: { _count: 'desc' } }, { updatedAt: 'desc' }];
        case 'durationAsc':
          return [{ durationSec: 'asc' }, { updatedAt: 'desc' }];
        case 'durationDesc':
          return [{ durationSec: 'desc' }, { updatedAt: 'desc' }];
        case 'intensityAsc':
          return [{ intensityCategory: 'asc' }, { updatedAt: 'desc' }];
        case 'intensityDesc':
          return [{ intensityCategory: 'desc' }, { updatedAt: 'desc' }];
        case 'titleAsc':
          return [{ title: 'asc' }, { updatedAt: 'desc' }];
        case 'relevance':
        default:
          return [{ updatedAt: 'desc' }, { createdAt: 'desc' }];
      }
    })();

    const [total, sessions] = await prisma.$transaction([
      prisma.workoutLibrarySession.count({ where }),
      prisma.workoutLibrarySession.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          discipline: true,
          tags: true,
          description: true,
          durationSec: true,
          intensityTarget: true,
          intensityCategory: true,
          distanceMeters: true,
          elevationGainMeters: true,
          equipment: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              usage: true,
            },
          },
        },
      }),
    ]);

    const ids = sessions.map((s) => s.id);
    const favorites =
      ids.length === 0
        ? []
        : await prisma.workoutLibraryFavorite.findMany({
            where: {
              coachId: user.id,
              librarySessionId: { in: ids },
            },
            select: { librarySessionId: true },
          });

    const favoriteSet = new Set(favorites.map((f) => f.librarySessionId));

    return success(
      {
        items: sessions.map((s) => {
          const { _count, ...rest } = s;
          return {
            ...rest,
            usageCount: _count.usage,
            favorite: favoriteSet.has(s.id),
          };
        }),
        total,
        page,
        pageSize,
      },
      {
        headers: privateCacheHeaders({ maxAgeSeconds: 30 }),
      }
    );
  } catch (error) {
    return handleError(error);
  }
}
