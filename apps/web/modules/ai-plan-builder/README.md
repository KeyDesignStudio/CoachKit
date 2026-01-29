# AI Plan Builder (v1)

Tranche 1 is **scaffolding only**:
- Feature-flag gated behind `AI_PLAN_BUILDER_V1` (defaults false)
- No live LLM calls
- Deterministic, testable server logic only
- Data stored in additive Prisma models (no changes to existing plan flows)

This module is intentionally isolated under `apps/web/modules/ai-plan-builder`.
