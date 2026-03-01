# Invisible Assistant Coach V1 (90-Day Build Spec)

## 1) Scope

### V1 outcome (ships in 90 days)
Coach-facing Assistant that:
- Detects 5 high-value patterns from `CalendarItem`, `CompletedActivity`, and wellness input.
- Generates recommended actions (plan and messaging).
- Produces explainable evidence + confidence.
- Integrates with existing AI Plan Builder and chat foundations.

### Explicit non-goals (V1)
- No always-on real-time stream processing.
- No medical diagnosis.
- No black-box predictive model dependency.

## 2) Existing foundation to reuse (from current codebase)

### Planning foundation (already exists)
- `AiPlanDraft`, `AiPlanDraftSession`, `PlanChangeProposal`, `PlanChangeAudit`, `AiInvocationAudit`.
- Coach APIs already support proposal generation, preview, approve/reject, apply-safe.
- Use this as the execution rail for Assistant plan changes.

### Chat/message foundation (already exists)
- `MessageThread` (unique per coach-athlete pair) and `Message`.
- `/api/messages/send` already supports coach -> athlete with ownership checks.
- Use this as the send rail for drafted intervention messages.

### Athlete performance inputs (already exists)
- `CalendarItem` stores prescribed/planned session state.
- `CompletedActivity` stores completed outcomes + provider metadata + `metricsJson` + `rpe`.
- This is enough for V1 pattern evidence, with additive daily wellness table.

## 3) Pattern detections (5 shippable in 90 days)

All five are deterministic rules with evidence scoring and cooldown.

### Pattern A: sleep_underperformance_v1
- Problem: key intensity sessions degrade after short sleep.
- Inputs: `assistant_daily_metrics.sleepHours`, completed session outcome for intensity-tagged sessions.
- Trigger: in last 35 days, at least 5 key sessions and at least 3 low-sleep key sessions, with materially lower completion/performance on low-sleep days.
- Recommended actions:
- Replace next intensity with aerobic endurance.
- Reduce next intensity volume 20-30%.

`logic_config`:
```json
{
  "windowDays": 35,
  "cooldownDays": 7,
  "requiredSignals": ["sleep_hours", "session_outcome"],
  "keySessionClassifier": {
    "calendarItem": {
      "intensityTypes": ["THRESHOLD", "VO2", "Z4", "Z5"],
      "titleRegex": "(threshold|vo2|interval|tempo|race pace)"
    }
  },
  "thresholds": {
    "lowSleepHours": 6.0,
    "minKeySessions": 5,
    "minLowSleepKeySessions": 3,
    "completionDeltaPct": 15,
    "rpeDelta": 1
  },
  "severityRules": {
    "high": "completion_delta_pct>=25 OR missed_intervals_count>=3",
    "medium": "completion_delta_pct>=15",
    "low": "otherwise"
  }
}
```

### Pattern B: monday_skip_cluster_v1
- Problem: adherence friction after hard weekend.
- Inputs: planned + missed sessions (`CalendarItem.status = SKIPPED` or inferred miss), previous-day load from completed activity.
- Trigger: same weekday misses >= 3 in 6 weeks and prior-day load exceeds hard threshold.
- Recommended actions:
- Shift Monday load to Tuesday.
- Convert Monday to optional recovery.

`logic_config`:
```json
{
  "windowDays": 42,
  "cooldownDays": 14,
  "requiredSignals": ["calendar_status", "daily_load"],
  "thresholds": {
    "targetWeekday": 1,
    "minMisses": 3,
    "priorDayHard": {
      "durationMinutes": 90,
      "intensityCount": 1
    }
  },
  "missStatus": ["SKIPPED"],
  "severityRules": {
    "high": "miss_count>=4",
    "medium": "miss_count==3",
    "low": "otherwise"
  }
}
```

### Pattern C: fatigue_intensity_collision_v1
- Problem: acute load ramps too fast while intensity clusters.
- Inputs: rolling load from completed sessions + planned intensity density + optional fatigue score.
- Trigger: acute/chronic load ratio above threshold and 2+ hard sessions in 3-day cluster.
- Recommended actions:
- Enforce 48h spacing.
- Swap one hard day to aerobic.
- Suggest deload if persistent.

`logic_config`:
```json
{
  "windowDays": 42,
  "cooldownDays": 7,
  "requiredSignals": ["rolling_load", "intensity_density"],
  "thresholds": {
    "acuteDays": 7,
    "chronicDays": 28,
    "acwrHigh": 1.25,
    "intensityClusterDays": 3,
    "minIntensitySessionsInCluster": 2,
    "fatigueScoreHigh": 7
  },
  "severityRules": {
    "high": "acwr>=1.4 AND cluster_hits>=2",
    "medium": "acwr>=1.25 AND cluster_hits>=1",
    "low": "otherwise"
  }
}
```

### Pattern D: heat_context_penalty_v1
- Problem: environmental penalty misread as fitness drop.
- Inputs: activity temperature (provider metadata or manual tag), pace/HR/RPE proxies.
- Trigger: repeated underperformance on hot sessions vs matched normal-temp sessions.
- Recommended actions:
- Heat-adjusted targets.
- Time-of-day shift + hydration/fueling cues.

`logic_config`:
```json
{
  "windowDays": 56,
  "cooldownDays": 10,
  "requiredSignals": ["temperature", "outcome_proxy"],
  "thresholds": {
    "hotTempC": 26,
    "minHotInstances": 3,
    "minComparisonInstances": 3,
    "pacePenaltyPct": 4,
    "hrPenaltyBpm": 5,
    "rpeDelta": 1
  },
  "matching": {
    "sameDiscipline": true,
    "durationTolerancePct": 15,
    "routeOptional": true
  },
  "severityRules": {
    "high": "pace_penalty_pct>=7 OR hr_penalty_bpm>=8",
    "medium": "pace_penalty_pct>=4 OR hr_penalty_bpm>=5",
    "low": "otherwise"
  }
}
```

### Pattern E: long_session_fade_v1
- Problem: durability/pacing collapse late in long sessions.
- Inputs: long-session split behavior (first half vs second half).
- Trigger: consistent late fade across recent long sessions.
- Recommended actions:
- Finish-strong progression blocks.
- Pacing and fueling timing change.

`logic_config`:
```json
{
  "windowDays": 42,
  "cooldownDays": 7,
  "requiredSignals": ["long_session_split"],
  "thresholds": {
    "minLongSessionMinutes": 75,
    "minSessions": 4,
    "fadePct": 5,
    "hrDriftPct": 5
  },
  "severityRules": {
    "high": "fade_instances>=3 AND max_fade_pct>=8",
    "medium": "fade_instances>=2",
    "low": "otherwise"
  }
}
```

## 4) Data model (proper additive design)

Keep existing APB and messaging tables; add Assistant-specific entities.

### New enums (Prisma)
```prisma
enum AssistantPatternCategory {
  ADHERENCE
  READINESS
  DURABILITY
  ENVIRONMENT
  RISK
}

enum AssistantDefinitionStatus {
  DRAFT
  ACTIVE
  DEPRECATED
}

enum AssistantSeverity {
  LOW
  MEDIUM
  HIGH
}

enum AssistantDetectionState {
  NEW
  VIEWED
  DISMISSED
  SNOOZED
  ACTIONED
}

enum AssistantRecommendationType {
  PLAN_ADJUSTMENT
  SESSION_SWAP
  INTENSITY_REDUCE
  SCHEDULE_SHIFT
  EDUCATION
  MESSAGE_ONLY
}

enum AssistantLlmOutputType {
  COACH_SUMMARY
  ATHLETE_MESSAGE_DRAFT
  RATIONALE
  CHATBOT_CONTEXT_PACK
}

enum AssistantActionType {
  APPLY_PLAN_CHANGE
  SEND_MESSAGE
  EDIT_MESSAGE
  DISMISS
  SNOOZE
  OPEN_CHAT
}
```

### New models (Prisma)
```prisma
model AssistantDailyMetric {
  id           String   @id @default(cuid())
  athleteId    String
  date         DateTime
  sleepHours   Float?
  fatigueScore Int?
  hrv          Float?
  restingHr    Float?
  stressScore  Int?
  moodScore    Int?
  notes        String?
  source       String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  athlete AthleteProfile @relation(fields: [athleteId], references: [userId], onDelete: Cascade)

  @@unique([athleteId, date])
  @@index([athleteId, date])
}

model AssistantPatternDefinition {
  id              String                    @id @default(cuid())
  key             String                    @unique
  name            String
  category        AssistantPatternCategory
  description     String
  status          AssistantDefinitionStatus @default(DRAFT)
  version         Int
  severityDefault AssistantSeverity         @default(MEDIUM)
  cooldownDays    Int                       @default(7)
  logicConfig     Json
  createdAt       DateTime                  @default(now())
  updatedAt       DateTime                  @updatedAt

  detections AssistantDetection[]

  @@unique([key, version])
  @@index([status, category])
}

model AssistantDetection {
  id                  String                 @id @default(cuid())
  athleteId           String
  coachId             String
  patternDefinitionId String
  detectedAt          DateTime               @default(now())
  periodStart         DateTime
  periodEnd           DateTime
  severity            AssistantSeverity
  confidenceScore     Int
  evidence            Json
  state               AssistantDetectionState @default(NEW)
  dismissReason       String?
  snoozedUntil        DateTime?
  createdAt           DateTime               @default(now())
  updatedAt           DateTime               @updatedAt

  athlete           AthleteProfile            @relation(fields: [athleteId], references: [userId], onDelete: Cascade)
  coach             User                      @relation(fields: [coachId], references: [id], onDelete: Cascade)
  patternDefinition AssistantPatternDefinition @relation(fields: [patternDefinitionId], references: [id], onDelete: Restrict)

  recommendations AssistantRecommendation[]
  llmOutputs       AssistantLlmOutput[]
  actions          AssistantAction[]

  @@index([coachId, state, detectedAt])
  @@index([athleteId, detectedAt])
  @@index([patternDefinitionId, detectedAt])
}

model AssistantRecommendation {
  id                 String                      @id @default(cuid())
  detectionId        String
  recommendationType AssistantRecommendationType
  title              String
  details            Json
  estimatedImpact    Json?
  createdAt          DateTime                    @default(now())

  detection AssistantDetection @relation(fields: [detectionId], references: [id], onDelete: Cascade)

  @@index([detectionId])
}

model AssistantLlmOutput {
  id            String                 @id @default(cuid())
  detectionId   String
  outputType    AssistantLlmOutputType
  content       String
  model         String?
  promptVersion String
  tokenUsage    Json?
  createdAt     DateTime               @default(now())

  detection AssistantDetection @relation(fields: [detectionId], references: [id], onDelete: Cascade)

  @@index([detectionId, outputType, createdAt])
}

model AssistantAction {
  id           String             @id @default(cuid())
  coachId      String
  athleteId    String
  detectionId  String
  actionType   AssistantActionType
  actionPayload Json?
  createdAt    DateTime           @default(now())

  coach     User              @relation(fields: [coachId], references: [id], onDelete: Cascade)
  athlete   AthleteProfile    @relation(fields: [athleteId], references: [userId], onDelete: Cascade)
  detection AssistantDetection @relation(fields: [detectionId], references: [id], onDelete: Cascade)

  @@index([coachId, createdAt])
  @@index([athleteId, createdAt])
  @@index([detectionId, createdAt])
}
```

### Integration links (reuse, no duplicate table)
- Plan changes: write through `PlanChangeProposal` and include:
  - `proposalJson.source = "assistant_recommendation"`
  - `proposalJson.sourceRef = detectionId`
- Messaging: send through `/api/messages/send`, log `AssistantAction(actionType=SEND_MESSAGE)` with message IDs.
- Chat context: create an Assistant context pack in `AssistantLlmOutput(outputType=CHATBOT_CONTEXT_PACK)` and attach to chat entrypoint.

## 5) Assistant context pack (shared APB + chat primitive)

```json
{
  "version": "assistant_context_pack_v1",
  "athlete": {
    "athleteId": "...",
    "coachId": "...",
    "timezone": "Australia/Brisbane",
    "disciplines": ["RUN", "BIKE", "SWIM"],
    "goal": {"eventName": "...", "eventDate": "2026-09-12"}
  },
  "plan": {
    "aiPlanDraftId": "...",
    "phase": "BUILD",
    "constraints": {"availableDays": ["Mon", "Tue", "Thu", "Sat"], "riskTolerance": "standard"}
  },
  "detection": {
    "detectionId": "...",
    "patternKey": "sleep_underperformance_v1",
    "severity": "MEDIUM",
    "confidenceScore": 78,
    "period": {"start": "2026-01-20", "end": "2026-02-28"},
    "evidence": {}
  },
  "recommendations": [
    {"id": "...", "type": "SESSION_SWAP", "title": "Swap next threshold to aerobic", "details": {}}
  ],
  "llmArtifacts": {
    "coachSummary": "...",
    "rationaleBullets": ["...", "..."],
    "messageDraft": "..."
  }
}
```

## 6) Detection engine architecture (V1)

### Execution model
- Jobs:
- Nightly batch for all active athletes.
- Optional post-activity trigger for the affected athlete.

### Pipeline
1. Load active `AssistantPatternDefinition`.
2. Pull required data windows from `CalendarItem`, `CompletedActivity`, `AssistantDailyMetric`.
3. Evaluate deterministic rule.
4. Compute explainable confidence:
- Evidence count (0-40)
- Effect size (0-40)
- Recency (0-20)
5. Apply cooldown and de-dup (same athlete + same pattern + active window hash).
6. Create `AssistantDetection` + `AssistantRecommendation`.
7. Call LLM once for `COACH_SUMMARY`, `RATIONALE`, `ATHLETE_MESSAGE_DRAFT`, `CHATBOT_CONTEXT_PACK`.

### Confidence scoring function
```ts
confidence = clamp(
  evidenceCountScore + effectSizeScore + recencyScore,
  0,
  100
)
```

### Idempotency key
- `sha256(athleteId + patternKey + periodStart + periodEnd + evidenceFingerprint)`
- Store in `evidence` and reject duplicate active detections.

## 7) API surface (new)

### Coach Assistant inbox
- `GET /api/coach/assistant/detections?state=NEW|VIEWED|SNOOZED|ACTIONED|DISMISSED&athleteId=&limit=&cursor=`
- Returns compact cards (athlete, title, summary, severity, confidence, timestamps).

### Detection detail
- `GET /api/coach/assistant/detections/:detectionId`
- Returns full evidence, recommendations, llm outputs, action history.

### State transitions
- `POST /api/coach/assistant/detections/:detectionId/snooze`
- body: `{ "days": 7 | 14 | 30 }`
- `POST /api/coach/assistant/detections/:detectionId/dismiss`
- body: `{ "reason": "..." }`
- `POST /api/coach/assistant/detections/:detectionId/mark-actioned`

### Apply to plan
- `POST /api/coach/assistant/detections/:detectionId/apply-plan`
- body: `{ "recommendationId": "...", "aggressiveness": "conservative|standard|aggressive", "aiPlanDraftId": "..." }`
- Server action:
- Creates/updates `PlanChangeProposal` with source metadata.
- Returns proposal preview (`diffJson`, rationale, safety flags).

### Draft/send message
- `POST /api/coach/assistant/detections/:detectionId/draft-message`
- optional tone/verbosity controls.
- `POST /api/coach/assistant/detections/:detectionId/send-message`
- wraps `/api/messages/send`, then logs `AssistantAction`.

### Discuss in chat
- `POST /api/coach/assistant/detections/:detectionId/discuss`
- Creates/returns session handle with attached context pack.

## 8) UI spec (premium, not gimmicky)

Use existing primitives: `Block`, `Button`, `tokens`, consistent with current coach console.

### Route structure
- `/coach/assistant` (inbox)
- `/coach/assistant/:detectionId` (detail page or right drawer)

### A) Assistant Inbox

#### Layout
- Left rail filter chips: `New`, `Needs attention`, `Snoozed`, `Actioned`.
- Main list: detection cards grouped by athlete.
- Cap new alerts: max 3 per athlete per 7 days.

#### Detection card spec
- Header: athlete avatar/name, timestamp, severity dot.
- Title: single-line pattern label.
- Summary: one sentence max (LLM summary excerpt).
- Confidence badge: `78%` with neutral styling.
- Actions: `View`, `Snooze`, `Dismiss`.

#### Visual rules
- Keep card density compact (`tokens.spacing.blockPaddingX`, `blockGapY`).
- No noisy icons or excessive color; use one accent (`--primary`) + severity dot only.

### B) Insight Panel / Detail page

#### Sections
1. `What I’m seeing`
- 2-3 bullets from `COACH_SUMMARY`.

2. `Evidence`
- Instance table (date, session, outcome, key signal).
- One micro-visual only (e.g., low-sleep vs normal completion bar).

3. `Recommended actions`
- Action cards with `Apply to plan`, `Draft message`, `Discuss`.

4. `Coach control`
- Dismiss reason select + text.
- Snooze quick chips (7/14/30).
- Mark actioned.

### C) Apply to plan modal
- Shows proposal diff preview from APB proposal engine.
- Aggressiveness segmented control:
- `Conservative`: minimize volume/intensity changes.
- `Standard`: default rule payload.
- `Aggressive`: larger but safe adjustment envelope.
- Confirm -> create APB proposal -> preview -> approve path.

### D) Draft message composer
- Prefilled draft text.
- Tone select: `Direct`, `Encouraging`, `Matter-of-fact`.
- `Include evidence` checkbox (default off).
- Send uses existing messages API.

### E) Discuss in chat
- Opens chat surface seeded with context pack.
- Starter prompts:
- “Give two alternatives with Wednesday hard day preserved.”
- “How strong is sleep evidence vs fueling?”

## 9) LLM behavior and prompting

### Prompt families
- `assistant_summary_v1`
- `assistant_message_draft_v1`
- `assistant_rationale_v1`
- `assistant_chat_context_pack_v1`

### Guardrails
- Advisory only; avoid diagnosis language.
- Must cite explicit evidence features in output.
- Must return structured JSON before UI rendering.

### Shared provider strategy
- Reuse APB AI invocation path and auditing (`AiInvocationAudit`).
- Set capability names for rollup visibility:
- `assistant.summary`
- `assistant.message_draft`
- `assistant.rationale`
- `assistant.context_pack`

## 10) 90-day delivery plan

### Weeks 1-2
- Add Assistant Prisma models + migration.
- Seed 5 pattern definitions.
- Build `AssistantDailyMetric` ingestion (manual sleep + fatigue first).
- Build scheduler skeleton.

### Weeks 3-5
- Implement rules A, B, E first.
- Implement confidence + cooldown + dedupe.
- Create inbox list endpoint + base UI.

### Weeks 6-7
- Add LLM outputs + prompt versioning.
- Add detail panel and message draft composer.

### Weeks 8-9
- Integrate `apply-plan` with `PlanChangeProposal` flow.
- Add proposal preview modal and approve handoff.

### Weeks 10-11
- Integrate discuss flow with chat context pack.
- Add advisory guardrails and evidence-grounded responses.

### Weeks 12-13
- Beta flag rollout (coach subset).
- Add throttling, audit trail, and KPI dashboards.
- QA + scenario tests + launch checklist.

## 11) Acceptance criteria

### Detection quality
- Each of 5 pattern detectors passes deterministic fixture tests.
- Every detection includes evidence, confidence, and at least one recommendation.

### UX quality
- Inbox renders under 1.5s at P50 with 100 detections.
- Coach can dismiss/snooze in <= 2 clicks.
- Detail page gives clear evidence and next action without scrolling fatigue.

### End-to-end integration
- Apply to plan creates linked `PlanChangeProposal` with `sourceRef=detectionId`.
- Draft/send message succeeds via `MessageThread`/`Message`.
- Discuss opens with preloaded context pack.
- All actions logged in `AssistantAction`.

## 12) Instrumentation (must-have)

- `assistant_detection_created`
- `assistant_detection_viewed`
- `assistant_recommendation_applied`
- `assistant_message_sent`
- `assistant_detection_dismissed`
- `assistant_detection_snoozed`
- `assistant_discuss_opened`

Core metrics:
- detection-to-view rate
- view-to-action rate
- dismissal reason distribution
- proposal approval rate
- message send rate

## 13) Testing strategy

### Unit
- Rule engine fixtures for all 5 patterns.
- Confidence score determinism and bounds.

### Integration
- Detection write path (definitions -> detections -> recommendations -> llm outputs).
- Apply-plan endpoint writes valid APB proposal metadata.
- Send-message logs assistant action after message persistence.

### E2E (Playwright)
- Coach opens Assistant inbox.
- Opens detection detail.
- Applies recommendation to plan and sees proposal preview.
- Sends edited draft message.
- Opens Discuss and sees seeded context.

## 14) Answering your three integration questions with current foundation

1. Plan/workout representation now
- Primary training entities are `CalendarItem` (live calendar), and APB entities `AiPlanDraft`, `AiPlanDraftWeek`, `AiPlanDraftSession`, with changes via `PlanChangeProposal`.

2. Prescribed vs completed matching now
- Yes. `CalendarItem` (prescribed/planned) and `CompletedActivity` (completed) are linked with `calendarItemId`, plus match metadata (`matchScore`, `matchConfidence`, timing deltas).

3. Wellness signals now
- Currently available: limited direct wellness in existing core models (`AthleteSessionFeedback.sleepQuality`, RPE, soreness in APB flow). V1 needs additive daily metric ingestion table for robust assistant detection (sleep/fatigue baseline).
