# AI Plan Builder Rollback Guardrails (Phase H3)

## Objective
Contain risk quickly if APB release quality degrades in production.

This runbook is ordered by fastest/safest containment first.

---

## Severity & Response Targets

- `P0`: Immediate rollback action (start within 5 minutes)
- `P1`: Rollback decision within 15 minutes
- `P2`: Hotfix or controlled rollback within same business day

---

## Fast Containment Options (in order)

## 1) Hard feature off (safest)
Set:
- `AI_PLAN_BUILDER_V1=false`

Effect:
- APB routes/features are gated off.
- Existing non-APB coach/athlete flows continue.

Use when:
- APB route crashes, data corruption risk, or severe publish visibility issue.

## 2) Force deterministic mode
Set:
- `AI_PLAN_BUILDER_AI_MODE=deterministic`

Effect:
- Disables LLM-backed behavior while keeping APB functional.

Use when:
- Regression appears LLM-related (unsafe suggestions, malformed outputs, timeout spikes).

## 3) Capability-specific deterministic fallback
Set one or more:
- `AI_PLAN_BUILDER_AI_CAP_SUMMARIZE_INTAKE=deterministic`
- `AI_PLAN_BUILDER_AI_CAP_SUGGEST_DRAFT_PLAN=deterministic`
- `AI_PLAN_BUILDER_AI_CAP_SUGGEST_PROPOSAL_DIFFS=deterministic`

Effect:
- Narrow rollback for specific failing capability.

Use when:
- Only one APB capability is degraded.

## 4) Application rollback (previous stable deployment)
Use Vercel rollback to previous known-good production deployment.

Use when:
- Env containment is insufficient.

---

## Data Safety Guardrails

- Do not run destructive DB commands during incident response.
- Prefer feature/env rollback before DB intervention.
- Preserve audit trails (`PlanChangeAudit`, `PlanChangeProposal`) for root-cause analysis.

If incorrect proposals were applied:
- Use APB undo checkpoint flow to create and apply reverse proposal.
- Republish after revert and verify athlete-visible state.

---

## Verification Checklist After Rollback

1. API/health
- `GET /api/health/db` returns healthy.

2. Core flow sanity
- Coach dashboard loads.
- Athlete dashboard loads.
- If APB disabled: APB route is gated as expected.
- If APB enabled deterministic: generation/apply/publish path works.

3. Data visibility
- Athlete sees only published plan.
- No draft leakage to athlete.

4. Error trend
- Runtime error rate returns to baseline within 15 minutes.

---

## Incident Log Template

Capture:
- Start time
- Detection source
- Affected flows
- Chosen containment option
- Time containment applied
- Validation evidence
- Final resolution
- Follow-up actions

---

## Follow-up (within 24h)

1. Create incident issue with timeline and root cause.
2. Add/upgrade automated tests for failure mode.
3. Tighten quality gates if needed.
4. Re-run `npm run test:ai-plan-builder:gates:ci`.
5. Approve re-release only after UAT spot-check on affected flows.

