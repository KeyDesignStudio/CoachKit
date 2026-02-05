import { createHash } from 'crypto';
import { NextRequest } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { handleError, success } from '@/lib/http';
import { ApiError } from '@/lib/errors';

import { extractFromRawText, extractTextFromPdf } from '@/modules/plan-library/server/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const asString = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value.trim() : '');

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const form = await request.formData();
    const type = asString(form.get('type')) || 'TEXT';
    const title = asString(form.get('title')) || 'Untitled plan source';
    const sport = asString(form.get('sport')) || 'TRIATHLON';
    const distance = asString(form.get('distance')) || 'OTHER';
    const level = asString(form.get('level')) || 'BEGINNER';
    const durationWeeks = Number(asString(form.get('durationWeeks')) || '0');
    const season = asString(form.get('season')) || undefined;
    const author = asString(form.get('author')) || undefined;
    const publisher = asString(form.get('publisher')) || undefined;
    const licenseText = asString(form.get('licenseText')) || undefined;
    const sourceUrl = asString(form.get('sourceUrl')) || undefined;
    const sourceFilePath = asString(form.get('sourceFilePath')) || undefined;

    let rawText = '';
    let contentBytes: Buffer | null = null;
    let contentType: string | null = null;

    if (type === 'PDF') {
      const file = form.get('file');
      if (!file || typeof file === 'string') {
        throw new ApiError(400, 'FILE_REQUIRED', 'PDF upload is required.');
      }
      const arrayBuffer = await file.arrayBuffer();
      contentBytes = Buffer.from(arrayBuffer);
      contentType = file.type || 'application/pdf';
      rawText = await extractTextFromPdf(contentBytes);
    } else if (type === 'URL') {
      if (!sourceUrl) {
        throw new ApiError(400, 'URL_REQUIRED', 'sourceUrl is required for URL ingestion.');
      }
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        throw new ApiError(400, 'URL_FETCH_FAILED', `Failed to fetch sourceUrl (${response.status}).`);
      }
      contentType = response.headers.get('content-type');
      const buffer = Buffer.from(await response.arrayBuffer());
      contentBytes = buffer;
      if (contentType?.includes('pdf')) {
        rawText = await extractTextFromPdf(buffer);
      } else {
        rawText = buffer.toString('utf-8');
      }
    } else {
      rawText = asString(form.get('rawText'));
      if (!rawText) {
        throw new ApiError(400, 'TEXT_REQUIRED', 'rawText is required for TEXT ingestion.');
      }
      contentBytes = Buffer.from(rawText, 'utf-8');
    }

    const checksumSha256 = createHash('sha256').update(contentBytes ?? rawText).digest('hex');

    const extracted = extractFromRawText(rawText, Number.isFinite(durationWeeks) ? durationWeeks : null);

    const created = await prisma.$transaction(async (tx) => {
      const planSource = await tx.planSource.create({
        data: {
          type: type as any,
          title,
          sport: sport as any,
          distance: distance as any,
          level: level as any,
          durationWeeks: Number.isFinite(durationWeeks) && durationWeeks > 0 ? Math.floor(durationWeeks) : 0,
          season: season ? (season as any) : null,
          author,
          publisher,
          licenseText,
          sourceUrl,
          sourceFilePath,
          checksumSha256,
          rawText,
          rawJson: extracted.rawJson as any,
        },
      });

      const version = await tx.planSourceVersion.create({
        data: {
          planSourceId: planSource.id,
          version: 1,
          extractionMetaJson: {
            contentType,
            warnings: extracted.warnings,
            confidence: extracted.confidence,
            sessionCount: extracted.sessions.length,
            weekCount: extracted.weeks.length,
          } as any,
        },
      });

      if (extracted.weeks.length) {
        await tx.planSourceWeekTemplate.createMany({
          data: extracted.weeks.map((week) => ({
            planSourceVersionId: version.id,
            weekIndex: week.weekIndex,
            phase: week.phase ?? null,
            totalMinutes: week.totalMinutes ?? null,
            totalSessions: week.totalSessions ?? null,
            notes: week.notes ?? null,
          })),
        });
      }

      if (extracted.sessions.length) {
        const weekIds = await tx.planSourceWeekTemplate.findMany({
          where: { planSourceVersionId: version.id },
          select: { id: true, weekIndex: true },
        });
        const weekMap = new Map(weekIds.map((w) => [w.weekIndex, w.id]));

        await tx.planSourceSessionTemplate.createMany({
          data: extracted.sessions
            .filter((session) => weekMap.has(session.weekIndex))
            .map((session) => ({
              planSourceWeekTemplateId: weekMap.get(session.weekIndex)!,
              ordinal: session.ordinal,
              dayOfWeek: session.dayOfWeek ?? null,
              discipline: session.discipline as any,
              sessionType: session.sessionType,
              title: session.title ?? null,
              durationMinutes: session.durationMinutes ?? null,
              distanceKm: session.distanceKm ?? null,
              intensityType: session.intensityType ?? null,
              intensityTargetJson: session.intensityTargetJson as any,
              structureJson: session.structureJson as any,
              notes: session.notes ?? null,
            })),
        });
      }

      if (extracted.rules.length) {
        await tx.planSourceRule.createMany({
          data: extracted.rules.map((rule) => ({
            planSourceVersionId: version.id,
            ruleType: rule.ruleType as any,
            phase: rule.phase ?? null,
            appliesJson: rule.appliesJson as any,
            ruleJson: rule.ruleJson as any,
            explanation: rule.explanation,
            priority: rule.priority,
          })),
        });
      }

      return { planSource, version };
    });

    return success({ planSource: created.planSource, version: created.version, extracted });
  } catch (error) {
    return handleError(error);
  }
}
