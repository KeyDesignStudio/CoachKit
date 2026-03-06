# Plan Library Workout Intelligence Tranche

This tranche upgrades Plan Library from a high-level plan-shaping input into a workout-design intelligence layer for APB.

## Problem

Current Plan Library ingestion is useful for:

- matching a plan archetype
- inferring discipline split
- inferring weekly volume curve
- inferring sessions per week
- inferring basic intensity density

Current ingestion is not strong enough for workout-level reuse:

- uploaded PDF/TEXT plans mostly produce coarse session rows
- interval structure is not reliably extracted
- intensity targets are not normalized into a canonical format
- drills and technique content are flattened into plain text notes
- `generateSessionDetail` does not receive reference workout recipes from Plan Library
- coach edits are not promoted back into a reusable exemplar set

The result is that APB can shape a plausible macro plan, but it cannot consistently reproduce the workout-design quality embedded in uploaded training plans.

## Goals

1. Parse uploaded plans into workout-level structured recipes.
2. Store original workout blocks in a canonical format CoachKit already understands.
3. Retrieve the best source workouts during session-detail generation.
4. Capture coach-edited workouts as reusable exemplars.
5. Add admin and coach visibility into what was parsed, what was used, and why.

## Non-goals

- Fine-tuning the model in this tranche.
- Replacing coach review with autonomous publishing.
- Full OCR/document-layout reconstruction for every PDF format.
- Using raw uploaded PDFs directly at runtime.

## Principle

Use uploaded plans as a structured retrieval corpus, not as opaque prompt text.

The canonical workout object for this tranche should be `SessionRecipeV2`, which already exists in APB and maps cleanly to session detail rendering.

Relevant files today:

- [session-recipe.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/rules/session-recipe.ts)
- [session-detail.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/rules/session-detail.ts)
- [extract.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/plan-library/server/extract.ts)
- [logic-compiler.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/plan-library/server/logic-compiler.ts)
- [draft-plan.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/draft-plan.ts)

## Target Architecture

### 1. Rich workout parser

Replace the current single-pass line parser with a staged extraction pipeline:

1. Document normalization
- extract text from PDF
- preserve page and line references where possible
- segment content into week/day/session candidates

2. Session candidate extraction
- identify discipline
- infer week/day placement
- infer workout title/type
- parse duration and distance
- parse target metrics
- parse block structure

3. Recipe builder
- compile session candidates into `SessionRecipeV2`
- normalize blocks into:
  - `warmup`
  - `main`
  - `cooldown`
  - `drill`
  - `strength`
- normalize targets into:
  - `RPE`
  - `ZONE`
  - `PACE`
  - `POWER`
  - `HEART_RATE`

4. Quality scoring
- assign parse confidence at source, session, and block level
- emit warnings for ambiguous sessions
- require manual review for low-confidence structured recipes

### 2. Canonical storage for structured workouts

Use `SessionRecipeV2` JSON as the canonical reusable structure.

The data model should support both:

- plan-source session templates derived from uploaded documents
- coach-created exemplars derived from edited APB or calendar workouts

## Proposed Schema Additions

### Extend `PlanSourceSessionTemplate`

Add additive fields:

- `recipeV2Json Json?`
- `parserConfidence Float?`
- `parserWarningsJson Json?`
- `targetMetricsJson Json?`
- `sourceLocatorJson Json?`
- `workoutFingerprint String?`

Purpose:

- `recipeV2Json`: canonical structured workout recipe
- `parserConfidence`: session-level parse confidence
- `parserWarningsJson`: unresolved ambiguity list
- `targetMetricsJson`: normalized metric summary for retrieval filters
- `sourceLocatorJson`: original page/line/block provenance
- `workoutFingerprint`: dedupe and exemplar linkage

### New table: `PlanSourceSessionExemplar`

Add a reusable exemplar table for both imported and coach-promoted sessions.

Suggested fields:

- `id String`
- `originType Enum('PLAN_SOURCE','COACH_EDIT','PUBLISHED_WORKOUT')`
- `originPlanSourceId String?`
- `originPlanSourceVersionId String?`
- `originPlanSourceSessionTemplateId String?`
- `originCalendarItemId String?`
- `originAiPlanDraftSessionId String?`
- `coachId String?`
- `title String`
- `discipline String`
- `sessionType String`
- `goalTag String?`
- `durationMinutes Int?`
- `distanceKm Float?`
- `intensityType String?`
- `targetMetricsJson Json?`
- `recipeV2Json Json`
- `tags String[]`
- `parserConfidence Float?`
- `qualityScore Float?`
- `approvalState Enum('DRAFT','APPROVED','REJECTED')`
- `isActive Boolean`
- `sourceFingerprint String`
- `createdAt DateTime`
- `updatedAt DateTime`

Purpose:

- unify imported workouts and coach-edited workouts under one retrieval surface
- allow manual approval before exemplar reuse
- make coach-owned exemplars outrank global defaults

### New table: `SessionExemplarFeedback`

Capture quality signals for exemplars.

Suggested fields:

- `id String`
- `exemplarId String`
- `feedbackType Enum('PROMOTED','USED','ACCEPTED','EDITED','REJECTED','TOO_HARD','TOO_EASY','UNSAFE','GOOD_FIT')`
- `actorId String`
- `actorRole Enum('ADMIN','COACH','SYSTEM')`
- `notes String?`
- `deltaJson Json?`
- `createdAt DateTime`

Purpose:

- measure exemplar quality over time
- upweight accepted/approved exemplars
- downweight rejected or heavily corrected exemplars

## Parsing Scope

The parser should explicitly target:

- discipline
- session type
- duration
- distance
- warmup/main/cooldown blocks
- intervals:
  - reps
  - on
  - off
  - intent
- target metrics:
  - pace
  - power
  - heart rate
  - zone
  - RPE
- technique/drill notes
- equipment cues
- progression cues like build, descend, negative split

### Parsing strategy

Use a hybrid extractor:

1. Deterministic extraction first
- regex and line grammar for obvious patterns
- sport-specific parsers:
  - run intervals
  - swim sets
  - bike power/zone blocks
  - strength circuits

2. Optional assisted extraction second
- introduce a new APB admin capability for low-confidence parse repair
- only used on stored source text, never directly from client
- output must validate into `SessionRecipeV2`

This should be behind a runtime/admin capability toggle, not always on.

## Retrieval for Workout Design

### Retrieval entry point

Add a server helper:

- `selectSessionExemplarsForDraftSession(...)`

Inputs:

- selected plan source version ids from the draft
- athlete profile
- draft setup
- session skeleton:
  - discipline
  - type
  - duration
  - week index
  - day of week
- optional coach context

Output:

- top `1-3` exemplars with reasons and confidence

### Retrieval ranking

Score on:

- exact discipline match
- session type match
- duration band
- target event distance
- athlete level
- phase / week context
- selected plan source affinity
- coach-owned exemplar priority
- positive feedback history
- parser confidence

Priority order:

1. coach-approved exemplars
2. selected plan source sessions from the current draft
3. high-scoring global plan-source exemplars

## Session-detail generation changes

Current `GenerateSessionDetailInput` does not accept any workout-reference recipes.

Extend it with:

- `referenceRecipes?: Array<{`
- `  exemplarId: string;`
- `  sourceType: 'plan_source' | 'coach_exemplar';`
- `  title: string;`
- `  discipline: string;`
- `  sessionType: string;`
- `  durationMinutes?: number | null;`
- `  reasons: string[];`
- `  recipeV2: SessionRecipeV2;`
- `  confidence: number;`
- `}>`

Relevant type file:

- [types.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/ai/types.ts)

### Generation behavior

`generateSessionDetail` should:

1. receive the deterministic session skeleton
2. receive `referenceRecipes`
3. use those references to shape:
- block order
- interval construction
- intensity targeting
- drill selection
- wording of execution cues

The output must still be validated by:

- [session-detail.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/rules/session-detail.ts)

### Fallback behavior

If no strong exemplar exists:

- fall back to current deterministic session builder

If exemplar confidence is low:

- keep the structure conservative
- surface a trace message in the reasoning/audit layer

## Coach Feedback Loop

### Promotion path

When a coach edits a generated session detail or a calendar workout, provide:

- `Promote as exemplar`
- `Save to coach library`

This should capture:

- final `recipeV2`
- discipline
- session type
- duration
- target metrics
- tags
- origin linkage
- approval state

### Feedback signals to capture

When a coach edits a generated session, store:

- which blocks changed
- whether targets changed
- whether intervals changed
- whether the coach marked it better/worse

Use that to:

- promote good edited workouts into exemplars
- down-rank poor exemplars
- build a coach-specific workout design corpus

### Reuse policy

Only reuse exemplars that are:

- approved by coach/admin
- active
- above a quality threshold

Default policy:

- manual promotion first
- auto-promotion later only after enough acceptance data

## Admin and Coach UI

### Admin: Plan Library page

Add to `/admin/plan-library`:

- structured parse quality summary per source
- count of structured sessions vs plain-text sessions
- exemplar count
- parser warnings
- view parsed recipe blocks
- re-extract structured workouts action

### Admin: Engine Controls

Add a new panel under engine controls for plan intelligence:

- parser mode:
  - deterministic only
  - deterministic + assisted repair
- parse confidence threshold
- maximum exemplars per session detail call
- coach exemplar priority weight
- global plan-source weight
- feedback promotion threshold

### Coach UI

Add to APB review/session detail surfaces:

- which reference workout(s) were used
- why they matched
- promote to exemplar
- reject exemplar
- mark as:
  - too hard
  - too easy
  - unsafe
  - good fit

## Rollout Plan

### Phase A: Structured recipe ingestion

Deliver:

- parser v2 for workout blocks and targets
- `recipeV2Json` storage on plan-source sessions
- parse confidence and warnings
- admin preview of parsed workouts

Success criteria:

- at least 70% of structured library sessions produce valid `recipeV2`
- parser warnings visible in admin

### Phase B: Session-detail grounding

Deliver:

- session exemplar selection
- `referenceRecipes` in `GenerateSessionDetailInput`
- session detail grounded on retrieved recipes
- audit trail of which exemplar was used

Success criteria:

- generated workout detail shows materially better structural specificity
- no regression in schema pass rate

### Phase C: Coach exemplar loop

Deliver:

- promote edited workout to exemplar
- exemplar feedback events
- coach-owned exemplar retrieval priority

Success criteria:

- coach-approved exemplars are reused in later sessions
- approval/rejection signals visible in admin

### Phase D: Quality and safety gates

Deliver:

- eval pack for workout recipe fidelity
- regression suite across swim/bike/run/strength
- quality dashboards for parse confidence, exemplar reuse, edit rate

Success criteria:

- lower post-generation coach edit rate
- stable or improved safety gate performance

## Acceptance Criteria

This tranche is done when:

1. Uploaded plans can produce valid structured workout recipes, not just coarse session rows.
2. Session-detail generation can cite and use matched workout exemplars.
3. Coach edits can be promoted into reusable exemplars.
4. Admin can inspect parse quality, exemplar usage, and feedback signals.
5. APB quality tests show improved workout-detail specificity without increasing safety failures.

## Recommended First Sprint

Build this in the following order:

1. extend `PlanSourceSessionTemplate` with `recipeV2Json`, parse confidence, warnings
2. implement parser v2 for run/swim/bike interval extraction
3. add admin parsed-workout preview to `/admin/plan-library`
4. extend `GenerateSessionDetailInput` with `referenceRecipes`
5. retrieve top `1-2` exemplars from selected plan sources during session-detail generation
6. add manual `Promote as exemplar` for coach-edited sessions

## Initial Fixture Corpus

Use these real PDFs as parser fixtures for the first implementation pass:

1. [PlanOlympic6mth.pdf](/Users/gordonprice/Downloads/PlanOlympic6mth.pdf)
- style: workout-rich triathlon plan with repeated session cards
- strengths:
  - clear swim/bike/run labels
  - warm-up / main set / cool-down sections
  - distance and PE targets
  - interval-like notation inside swim and bike sessions
- parser requirements:
  - nested set parsing
  - PE extraction
  - block extraction for swim sets

2. [12WkOlympicBeginner.pdf](/Users/gordonprice/Downloads/12WkOlympicBeginner.pdf)
- style: week/day grid with prose-heavy session descriptions
- strengths:
  - clear weekly schedule layout
  - identifiable session categories like swim, brick, cross, rest-day
  - duration bands and cadence cues
- parser requirements:
  - schedule grid reconstruction
  - session-type and brick detection
  - prose-to-recipe conversion when block structure is only implied

3. [5k Run_ 45 Day Beginner Training Guide.pdf](/Users/gordonprice/Downloads/5k Run_ 45 Day Beginner Training Guide.pdf)
- style: beginner tabular progression plan
- strengths:
  - explicit day-by-day progression
  - repeatable workout patterns
  - optional workouts and off days clearly labeled
- parser requirements:
  - day-index extraction
  - repeated workout normalization
  - optional/off day classification
  - run-walk workout template generation

4. [Race_Your_First_703.pdf](/Users/gordonprice/Downloads/Race_Your_First_703.pdf)
- style: magazine-style foldout plan with editorial noise
- strengths:
  - rich zone language
  - abbreviations legend
  - dense swim-bike-run session prescriptions
- parser requirements:
  - aggressive layout/noise stripping
  - abbreviation normalization
  - zone-target extraction
  - handling of glossary-heavy pages mixed with plan content

These four fixtures should become the baseline parser acceptance set. A parser release should not be accepted unless it can extract stable structured outputs from all four styles.

## Why this tranche matters

Without this tranche, uploaded plans mostly influence macro structure.

With this tranche, CoachKit starts to accumulate real workout design intelligence:

- how good sessions are structured
- how intervals are prescribed
- how drills and targets are expressed
- how coaches refine generated workouts

That is the path from "reference plans exist" to "CoachKit actually learns how strong coaches build sessions."
