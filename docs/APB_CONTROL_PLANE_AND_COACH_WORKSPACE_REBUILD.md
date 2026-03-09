# APB Control Plane And Coach Workspace Rebuild

## Objective

Reshape the existing AI Plan Builder, coach assistant, and admin console into one connected system that:

- uses structured plan knowledge instead of raw documents
- helps coaches build, question, adjust, and publish plans without technical language
- gives admins the technical levers needed to govern engine behavior, knowledge quality, and source trust
- learns from coach edits and athlete outcomes across the full plan lifecycle

This is a rebuild of product shape, not a rewrite of the entire backend.

## Existing Surfaces To Reuse

### Coach surface

- `/coach/assistant`
- [workspace-page.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/app/coach/assistant/workspace-page.tsx)
- [console-page.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/app/coach/assistant/console-page.tsx)
- [AiPlanBuilderCoachJourney.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/ui/AiPlanBuilderCoachJourney.tsx)

### Admin surface

- `/admin`
- [page.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/app/admin/page.tsx)
- [AdminConsoleNav.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/components/admin/AdminConsoleNav.tsx)
- [AdminAiEngineControlsPage.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/ui/AdminAiEngineControlsPage.tsx)
- [AdminPolicyTuningPage.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/ui/AdminPolicyTuningPage.tsx)
- [AdminPlanLibraryWorkspace.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/components/admin/AdminPlanLibraryWorkspace.tsx)
- [PlanLibraryQualityInsights.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/components/admin/PlanLibraryQualityInsights.tsx)
- [WorkoutExemplarCatalog.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/components/admin/WorkoutExemplarCatalog.tsx)

### APB core to keep and reshape

- [effective-input.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/effective-input.ts)
- [draft-plan.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/draft-plan.ts)
- [draft-generator.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/rules/draft-generator.ts)
- [constraint-validator.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/rules/constraint-validator.ts)
- [publish.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/publish.ts)
- [feedback.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/feedback.ts)
- [adaptations.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/adaptations.ts)
- [proposals.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/proposals.ts)
- [reference-recipes.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/reference-recipes.ts)
- [structured-library.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/plan-library/server/structured-library.ts)
- [select.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/plan-library/server/select.ts)
- [apply.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/plan-library/server/apply.ts)

## Product Direction

### Coach product

The coach should operate one product:

- `Coach Planning Workspace`

It should let the coach:

- understand the athlete context
- receive a recommended plan
- review risks and suggestions
- ask questions in plain language
- approve or apply changes
- publish and monitor the plan

The coach should not see internal AI terminology unless there is an explicit advanced mode.

### Admin product

The admin should operate one product:

- `AI Control Plane`

It should let the admin:

- control engine behavior
- tune planning policy
- manage the knowledge base
- govern trusted external sources
- inspect quality and outcome analytics
- inspect audits and operational health

## Shared Context Contract

Coach and admin surfaces must point at one shared planning context composed from:

- athlete profile
- latest submitted intake
- approved AI profile / athlete brief
- current training request
- current draft plan
- published plan state
- completed sessions and adherence signals
- fatigue / soreness / missed-session signals
- published plan templates
- workout exemplars
- coach edits and quality feedback

No assistant surface should operate as a detached side tool.

## What Must Be Retired

- APB decisions based on raw OCR/PDF text
- assistant/chat experiences detached from the current athlete and plan context
- coach-facing UI copy that exposes internal engine mechanics
- plan-library influence paths that only inject shallow hints with no traceability
- legacy naming that keeps `PlanSourceVersion` semantics in the APB path after `PlanLibraryTemplate` is the real source of truth

## Tranche Plan

### Tranche 1: Shell Convergence And Language Reset

Outcome:

- coach assistant becomes the clear planning workspace shell
- admin becomes the clear AI control-plane shell
- no backend behavior change required

Scope:

- rename and reframe coach assistant headers, tabs, status copy, and suggestion copy
- rename and reframe admin navigation and landing page copy
- reframe plan library under `Knowledge Base` language
- add rebuild spec into repo

Primary files:

- [workspace-page.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/app/coach/assistant/workspace-page.tsx)
- [console-page.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/app/coach/assistant/console-page.tsx)
- [page.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/app/admin/page.tsx)
- [AdminConsoleNav.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/components/admin/AdminConsoleNav.tsx)
- [AdminPlanLibraryWorkspace.tsx](/Volumes/DockSSD/Projects/CoachKit/apps/web/components/admin/AdminPlanLibraryWorkspace.tsx)

### Tranche 2: Canonical Planning Context

Outcome:

- one assembled APB context for coach workspace, suggestions, chat, and adaptations

Scope:

- formalize `AthleteStateAssembler`
- expose one plan-context payload for coach UI
- unify assistant detections, draft state, publish state, and athlete brief into one server contract

Primary files:

- [effective-input.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/effective-input.ts)
- [draft-plan.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/ai-plan-builder/server/draft-plan.ts)
- coach assistant APIs

### Tranche 3: Knowledge Base Quality Engine

Outcome:

- published templates gain trustworthy quality scoring
- APB can rank sources on more than simple fit

Scope:

- score progression, recovery spacing, balance, specificity, and session completeness
- store quality metrics per template
- surface quality in admin knowledge-base views

### Tranche 4: Retrieval And Skeleton Synthesis

Outcome:

- APB moves from `template hints` to `template-guided skeleton generation`

Scope:

- replace shallow template apply step
- retrieve top-fit published templates
- synthesize block structure, week types, recovery cadence, and discipline distribution before session generation

Primary files:

- [select.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/plan-library/server/select.ts)
- [apply.ts](/Volumes/DockSSD/Projects/CoachKit/apps/web/modules/plan-library/server/apply.ts)
- new skeleton synthesis service

### Tranche 5: Coach Suggestion Engine And Explainability

Outcome:

- coach sees proactive recommendations, not just raw detections
- coach can ask why a plan was built this way

Scope:

- reframe assistant detections as `suggestions`
- add `why this plan` traces
- add one-click `preview` and `apply` actions for safe modifications
- connect contextual Q&A to the live athlete plan context

### Tranche 6: Novelty Guard And Anti-Copy Controls

Outcome:

- source plans inform logic without being copied

Scope:

- session similarity checks
- week-pattern similarity checks
- publish blockers for near-clone drafts
- admin thresholds for novelty

### Tranche 7: Outcome Learning

Outcome:

- coach edits and athlete outcomes change future retrieval weights and suggestions

Scope:

- capture edit-rate, rejection-rate, adherence, soreness/injury signals
- reweight template trust and exemplar trust
- show trend analytics in admin

### Tranche 8: Trusted External Knowledge

Outcome:

- CoachKit can answer coaching questions using approved external sources as well as internal knowledge

Scope:

- external source registry
- source trust tiers
- plan influence vs question-answering controls
- citation / attribution policy

## Commencement Order

Build now in this order:

1. Tranche 1
2. Tranche 2
3. Tranche 3
4. Tranche 4

Do not start full external-source integration before the internal knowledge base, retrieval, and explainability path are stable.

## Success Criteria

### Coach-facing

- coach can stay inside one workspace for build, explanation, suggestion review, and publish
- AI language is coach-readable, not systems-readable
- suggested changes are actionable, not just descriptive

### Admin-facing

- admin can inspect engine controls, policy levers, knowledge quality, source trust, and audit state in one coherent shell
- published knowledge is clearly separated from drafts and rejected sources

### APB behavior

- APB uses only published structured templates and approved exemplars for planning influence
- APB stores why a template was chosen and how it influenced the draft
- APB can adapt plans using athlete outcomes and coach feedback
- APB does not copy source plans directly
