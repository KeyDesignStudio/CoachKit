# AI Plan Builder Release Checklist (Phase H3)

## Purpose
Operational checklist for promoting AI Plan Builder safely from closed beta toward commercial readiness.

Use with:
- `docs/APB_UAT_H2.md`
- `docs/APB_ROLLBACK_GUARDRAILS.md`

---

## Release Gate (Must Pass)

All items must be `PASS` before production release:

1. CI gates
- `npm run test:ai-plan-builder:gates:ci` passes in GitHub Actions (`APB Quality Gates` workflow).

2. Publish/redraft E2E
- `npm run test:ai-plan-builder:h1` passes in APB harness.

3. UAT
- `docs/APB_UAT_H2.md` complete.
- No open `P0`/`P1`.
- Any open `P2` has approved workaround and owner.

4. Ops readiness
- Rollback owner nominated.
- Rollback communication draft prepared.
- Feature-flag/env rollback steps verified in staging or preview.

---

## Pre-Release Checklist

### A) Data & Schema
- Confirm Prisma migrations for this release are deployed.
- Confirm no destructive migration risk for APB tables.
- Confirm DB backup/snapshot window is current.

### B) Feature Flags & Modes
- Confirm target value for `AI_PLAN_BUILDER_V1`.
- Confirm target `AI_PLAN_BUILDER_AI_MODE` (`deterministic` or `llm`).
- If `llm`, confirm fallback behavior and rate-limit thresholds are set.
- Confirm per-capability overrides are intentional (`inherit/deterministic/llm`).

### C) Deployment
- Confirm `main` merge commit and linked PRs.
- Confirm Vercel production deployment status is `Ready`.
- Confirm `/api/health/db` is healthy in production.

### D) Functional Smoke (Production)
- Coach can open APB route and load latest request/draft.
- Generate weekly structure succeeds.
- Propose + apply manual diff succeeds.
- Propose + apply AI adjustment succeeds.
- Publish succeeds and athlete can view published state.
- Undo proposal can be created from timeline for an applied proposal.

---

## Release Execution

1. Announce release start in internal channel.
2. Deploy `main` to production.
3. Run production smoke checklist above.
4. Monitor first 30 minutes for errors and user-reported regressions.
5. Mark release as `LIVE` only after smoke + monitoring pass.

---

## Post-Release Monitoring (First 24h)

Track:
- APB route availability and runtime errors.
- Proposal apply failures (especially `PROPOSAL_CONFLICT` volume spikes).
- Publish failures and calendar materialisation errors.
- AI fallback rate and rate-limit events.

Escalation thresholds:
- Any `P0` -> immediate rollback decision.
- Repeated core flow failures (plan generation/apply/publish) -> rollback decision within 15 minutes.

---

## Signoff Block

Release ID:
- `<fill>`

Release owner:
- `<fill>`

Approvers:
- Product: `<fill>`
- Engineering: `<fill>`
- QA/UAT: `<fill>`

Status:
- `GO` / `NO-GO`

Timestamp:
- `<fill>`

