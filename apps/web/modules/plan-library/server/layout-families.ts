import { prisma } from '@/lib/prisma';

export const PLAN_SOURCE_LAYOUT_FAMILY_PRESETS = [
  {
    slug: 'weekly-grid',
    name: 'Weekly Grid',
    familyType: 'grid',
    description: 'Week columns with weekday rows and one session cell per day.',
    extractorHintsJson: {
      signals: ['week columns', 'day rows', 'block title', 'daily cells'],
      idealFor: ['220 Triathlon style plans', 'multi-week summary pages'],
    },
  },
  {
    slug: 'table-plan',
    name: 'Table Plan',
    familyType: 'table',
    description: 'Structured table or spreadsheet-style plan with explicit columns and row labels.',
    extractorHintsJson: {
      signals: ['tabular rows', 'column headers', 'explicit metrics'],
      idealFor: ['simple PDF exports', 'beginner plan tables'],
    },
  },
  {
    slug: 'session-list',
    name: 'Session List',
    familyType: 'list',
    description: 'Sequential session list with explicit week/day markers inside the text flow.',
    extractorHintsJson: {
      signals: ['week headings', 'session headings', 'ordered lists'],
      idealFor: ['coach-authored PDFs', 'single-column plans'],
    },
  },
  {
    slug: 'prose-plan',
    name: 'Prose Plan',
    familyType: 'prose',
    description: 'Narrative plan with sessions embedded in paragraphs and headings.',
    extractorHintsJson: {
      signals: ['paragraph blocks', 'heading/subheading hierarchy'],
      idealFor: ['article-style plans', 'manual text ingests'],
    },
  },
  {
    slug: 'mixed-editorial',
    name: 'Mixed Editorial',
    familyType: 'editorial',
    description: 'Magazine-style plan with legends, branding, and non-schedule content mixed with workouts.',
    extractorHintsJson: {
      signals: ['editorial noise', 'legend blocks', 'branding fragments'],
      idealFor: ['magazine pullouts', 'multi-column layouts'],
    },
  },
] as const;

export type PlanSourceLayoutFamilyPreset = (typeof PLAN_SOURCE_LAYOUT_FAMILY_PRESETS)[number];

export type InferredLayoutFamily = {
  slug: PlanSourceLayoutFamilyPreset['slug'];
  confidence: number;
  reasons: string[];
};

function countMatches(value: string, regex: RegExp) {
  return [...value.matchAll(regex)].length;
}

export function inferLayoutFamily(params: { title?: string | null; rawText: string; sourceUrl?: string | null }):
  InferredLayoutFamily {
  const originalText = `${params.title ?? ''}\n${params.rawText ?? ''}`;
  const text = originalText.toLowerCase();
  const weekHits = countMatches(text, /\bweek\s*\d{1,2}\b/g);
  const dayHits = countMatches(text, /\b(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b/g);
  const tableHintHits = countMatches(text, /\b(mon|tue|wed|thu|fri|sat|sun)\b/g) + countMatches(text, /\b(swim|bike|run|rest|brick|strength)\b/g);
  const editorialHits = countMatches(
    text,
    /\b(220triathlon|220 triathlon|training zones?|how it works|meet the expert|photos|illustrations|cut out the guide|fold the guide|tri\d+\.plan)\b/g
  );
  const paragraphHits = countMatches(originalText, /[.!?]\s+[A-Z]/g);
  const sentenceHits = countMatches(originalText, /[.!?](?:\s|$)/g);
  const newlineDensity = (params.rawText.match(/\n/g) ?? []).length;

  if (weekHits >= 3 && dayHits >= 5) {
    return {
      slug: editorialHits >= 3 ? 'mixed-editorial' : 'weekly-grid',
      confidence: editorialHits >= 3 ? 0.78 : 0.9,
      reasons: editorialHits >= 3
        ? ['week headers found', 'weekday labels found', 'editorial/legend noise also detected']
        : ['week headers found', 'weekday labels found', 'daily grid structure strongly implied'],
    };
  }

  if (weekHits >= 2 && tableHintHits >= 8) {
    return {
      slug: 'table-plan',
      confidence: 0.76,
      reasons: ['tabular workout cues found', 'repeated weekday/discipline tokens suggest columnar plan'],
    };
  }

  if (weekHits >= 2 && newlineDensity >= 20) {
    return {
      slug: 'session-list',
      confidence: 0.68,
      reasons: ['explicit week markers found', 'single-column session flow likely'],
    };
  }

  if (editorialHits >= 3) {
    return {
      slug: 'mixed-editorial',
      confidence: 0.58,
      reasons: ['editorial/magazine markers dominate extracted text'],
    };
  }

  if ((paragraphHits >= 2 || sentenceHits >= 2) && weekHits === 0 && dayHits === 0 && newlineDensity <= 12) {
    return {
      slug: 'prose-plan',
      confidence: 0.52,
      reasons: ['narrative paragraph structure dominates the source'],
    };
  }

  return {
    slug: 'session-list',
    confidence: 0.34,
    reasons: ['defaulted to session-list because the layout could not be classified strongly'],
  };
}

export async function ensurePlanSourceLayoutFamilies() {
  await Promise.all(
    PLAN_SOURCE_LAYOUT_FAMILY_PRESETS.map((preset) =>
      prisma.planSourceLayoutFamily.upsert({
        where: { slug: preset.slug },
        update: {
          name: preset.name,
          familyType: preset.familyType,
          description: preset.description,
          extractorHintsJson: preset.extractorHintsJson as any,
          isPreset: true,
          isActive: true,
        },
        create: {
          slug: preset.slug,
          name: preset.name,
          familyType: preset.familyType,
          description: preset.description,
          extractorHintsJson: preset.extractorHintsJson as any,
          isPreset: true,
          isActive: true,
        },
      })
    )
  );

  return prisma.planSourceLayoutFamily.findMany({
    where: { isActive: true },
    orderBy: [{ isPreset: 'desc' }, { name: 'asc' }],
  });
}
