import { describe, expect, it } from 'vitest';

import { deriveManualSessionTemplateFields, extractFromRawText } from '@/modules/plan-library/server/extract';
import { parseWorkoutRecipeFromSessionText } from '@/modules/plan-library/server/workout-recipe-parser';

describe('plan-library workout parser', () => {
  it('parses structured swim sets with warmup, main set, cooldown, and RPE targets', () => {
    const parsed = parseWorkoutRecipeFromSessionText({
      discipline: 'SWIM',
      sessionType: 'technique',
      sessionText: `
        Warm-up
        200m various strokes
        Main Set
        1500m (200m drill, 300m FC @ PE 5-6; 200m drill, 2 x 150m FC @ PE 6-7; 200m drill, 3 x 100m FC @ PE 7-8)
        Take 20-30secs rest between sets
        Cool-down
        100m your stroke choice
      `,
      title: '220 Olympic swim set',
    });

    expect(parsed.recipeV2).toBeTruthy();
    expect(parsed.recipeV2?.blocks.map((block) => block.key)).toEqual(['warmup', 'main', 'cooldown']);
    expect(parsed.intensityType).toBe('RPE');
    expect(parsed.recipeV2?.blocks.find((block) => block.key === 'main')?.intervals?.some((entry) => entry.reps === 2 && entry.on.includes('150m'))).toBe(
      true
    );
    expect(parsed.recipeV2?.blocks.find((block) => block.key === 'main')?.intervals?.some((entry) => entry.reps === 3 && entry.on.includes('100m'))).toBe(
      true
    );
    expect(parsed.estimatedDurationMinutes).toBeNull();
    expect(parsed.confidence).toBeGreaterThan(0.6);
  });

  it('parses zone-based sessions with shorthand headings and preserves drill blocks', () => {
    const parsed = parseWorkoutRecipeFromSessionText({
      discipline: 'SWIM',
      sessionType: 'technique',
      sessionText: `
        WU (Z2): 800m as (400m FC, 200m pull, 100m kick, 100m FC)
        Technique (Z2): 8 x 50m as (1-2 head up, 3-4 pull, 5-6 fists, 7-8 FC)
        Main (Z2/Z3): 300m FC +20secs. 200m pull +10secs. 100m FC
        WD (Z1): 200m alternating back/FC
      `,
      title: '70.3 technique swim',
    });

    expect(parsed.recipeV2).toBeTruthy();
    expect(parsed.intensityType).toBe('ZONE');
    expect(parsed.recipeV2?.blocks.map((block) => block.key)).toEqual(['warmup', 'drill', 'main', 'cooldown']);
    expect(parsed.recipeV2?.blocks.find((block) => block.key === 'drill')?.intervals?.[0]?.reps).toBe(8);
    expect(parsed.recipeV2?.qualityChecks.length).toBeGreaterThan(1);
  });

  it('extracts multiline sessions into plan-source templates with richer workout structure', () => {
    const extracted = extractFromRawText(
      `
        Week 1
        Mon
        SWIM
        Easy swim, 30-40mins.
        Use warm-up to work on technique then go for longer reps - 400-600m - at an easy to steady pace.
        Wed
        BIKE
        Steady bike, 40-60mins.
        On the turbo. 5mins warm up then 4 x (6mins at a steady intensity with 2mins easy recovery between). 5mins easy warm down.
        Fri
        RUN/WALK
        10-20min and run at least 0.5 mile or 5min and walk the rest.
      `,
      4
    );

    expect(extracted.sessions).toHaveLength(3);
    expect(extracted.sessions[0]?.weekIndex).toBe(0);
    expect(extracted.sessions[0]?.dayOfWeek).toBe(1);
    expect(extracted.sessions[0]?.recipeV2Json).toBeTruthy();
    expect((extracted.sessions[0]?.recipeV2Json as any)?.blocks?.length ?? 0).toBeGreaterThan(0);
    expect(extracted.sessions[1]?.discipline).toBe('BIKE');
    expect(extracted.sessions[1]?.durationMinutes).toBe(50);
    expect(extracted.sessions[2]?.discipline).toBe('RUN');
    expect(extracted.sessions[2]?.sessionType).toBe('run-walk');
  });

  it('infers missing week markers in round-robin order when the source layout is ambiguous', () => {
    const extracted = extractFromRawText(
      `
        SWIM
        Easy swim 30min
        BIKE
        Steady bike 60min
        RUN
        Easy run 40min
        SWIM
        Technique swim 35min
        BIKE
        Tempo bike 50min
        RUN
        Long run 70min
      `,
      2
    );

    expect(extracted.sessions).toHaveLength(6);
    expect(extracted.sessions.map((session) => session.weekIndex)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(extracted.warnings.some((warning) => /round-robin/i.test(warning))).toBe(true);
  });

  it('does not treat editorial guidance as workout sessions just because a discipline word appears at line start', () => {
    const extracted = extractFromRawText(
      `
        Please read this before you start this plan.
        Run non-stop for an hour.
        Bike days and leg days should alternate.
        Swim training tips are listed below.
      `,
      6
    );

    expect(extracted.sessions).toHaveLength(0);
  });

  it('segments editorial magazine content and converts mile-based workouts to kilometers', () => {
    const extracted = extractFromRawText(
      `
        TRAINING ZONES
        ZONE 1 Recovery
        KEY
        MTB Off-road bike FC Front crawl

        WEEK 01
        Mon
        Swim 1 mile easy with 4 x 200m build
        Wed
        Run 3.1 miles tempo. 10min warm up, 3 x 1 mile at race pace, 5min cool down
      `,
      12
    );

    expect(extracted.sessions).toHaveLength(2);
    expect(extracted.sessions[0]?.distanceKm).toBeCloseTo(1.6, 1);
    expect(extracted.sessions[1]?.distanceKm).toBeCloseTo(5, 1);
    expect(String(extracted.sessions[1]?.notes ?? '')).toContain('5km');
    expect(extracted.warnings.some((warning) => /segmentation removed/i.test(warning))).toBe(true);
  });

  it('treats parser-studio manual corrections as trusted session overrides while still normalizing miles to kilometers', () => {
    const manual = deriveManualSessionTemplateFields({
      discipline: 'RUN',
      title: 'Tempo run',
      notes: 'Run 3.1 miles at race pace with 10min warm up and 5min cool down.',
      sessionType: 'tempo',
      editor: { email: 'admin@example.com', editedAt: '2026-03-06T10:00:00.000Z' },
    });

    expect(manual.sessionType).toBe('tempo');
    expect(manual.distanceKm).toBeCloseTo(5, 1);
    expect(String(manual.notes ?? '')).toContain('5km');
    expect(manual.parserConfidence).toBe(1);
    expect((manual.structureJson as any)?.editor?.source).toBe('parser-studio');
  });

  it('recovers multiple sessions from dense merged OCR text instead of collapsing to a single blob', () => {
    const extracted = extractFromRawText(
      `
        12 WEEK OLYMPIC TRAINING PLAN | WEEKS 5-8 220TRIATHLON.COM MonWedFriSunTueThursSat
        Block 2 - Improving speed and endurance
        Week 5 Week 6 Week 7 Week 8
        SWIM Easy swim, 60mins working on base endurance.
        RUN Technique run, 40-50mins.
        BIKE Hilly bike, 75-90mins.
        REST-DAY Massage or light stretching.
        SWIM Tempo swim, 75mins.
        RUN Fartlek run, 30-40mins.
        BIKE Progressive bike, 85-95mins.
        BRICK Bike 90mins with run off bike 30-40mins.
        RUN Long run, 60-75mins.
        SWIM Technique swim, 45mins.
        BIKE Easy bike, 60mins.
        OPTIONAL Optional session, 30-60mins.
      `,
      12
    );

    expect(extracted.sessions.length).toBeGreaterThanOrEqual(8);
    expect(extracted.sessions.some((session) => session.discipline === 'SWIM')).toBe(true);
    expect(extracted.sessions.some((session) => session.discipline === 'RUN')).toBe(true);
    expect(extracted.sessions.some((session) => session.discipline === 'BIKE')).toBe(true);
  });

});
