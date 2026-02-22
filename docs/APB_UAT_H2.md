# AI Plan Builder UAT (Phase H2)

## Scope
This script validates the end-to-end Coach and Athlete workflows for AI Plan Builder in closed beta.

## Environments
- Production: `https://coach-kit.vercel.app`
- Coach route example: `https://coach-kit.vercel.app/coach/athletes/user-athlete-one/ai-plan-builder`
- Athlete profile route example: `https://coach-kit.vercel.app/athlete/profile`
- Athlete notifications route example: `https://coach-kit.vercel.app/athlete/notifications`

## Preconditions
- Coach user can access at least one athlete.
- Athlete has a valid profile and intake baseline.
- AI Plan Builder feature is enabled in deployed environment.
- At least one draft can be generated from training request.

## Exit Criteria
- No `P0` or `P1` defects.
- All `Critical` and `High` cases pass.
- Publish/redraft/undo flows are fully operational.
- Athlete visibility rules hold across all checks.

---

## Severity Model
- `P0`: Data corruption / security / publish visibility breach
- `P1`: Core flow blocked (cannot plan/publish/redraft)
- `P2`: Major UX or logic issue with workaround
- `P3`: Minor UX/content issue

---

## Coach UAT Script

### C1. Training Request Lifecycle (Critical)
1. Open AI Plan Builder.
2. Create/open training request.
3. Fill all core fields (goal, event date, availability, injury/constraints, weekly minutes, experience).
4. Save draft, refresh, confirm values persist.
5. Mark request complete and confirm status.

Expected:
- Request status is clear and consistent.
- No hidden or stale values after refresh.

### C2. Block Blueprint Sync (Critical)
1. Click sync/apply request into blueprint.
2. Confirm request values map to blueprint values correctly.
3. Validate available days and weekly minutes match request.

Expected:
- No conflicting fields.
- No stale legacy values overriding request.

### C3. Generate Weekly Structure (Critical)
1. Click generate weekly structure.
2. Confirm progress indicator appears and completes.
3. Verify generated weeks follow requested availability and no-doubles constraints.
4. Verify week labels include week number + date range context.

Expected:
- Generation completes without hard constraint error.
- No sessions on unavailable days.
- Doubles count respects request cap.

### C4. Detail Generation Scope Controls (High)
1. Generate details for selected week.
2. Generate details for entire plan.
3. Validate execution text quality (purpose, structure, explainability fields).

Expected:
- Scope behavior is correct.
- Details are generated without per-session button dependence.

### C5. Proposal & Diff Review (Critical)
1. Create manual edit proposal from week/session changes.
2. Create AI adjustment proposal.
3. Open diff preview from proposal/timeline.
4. Apply one proposal, reject another.

Expected:
- Proposal statuses and timeline entries are accurate.
- Diff summary and week-level changes are visible and understandable.

### C6. Conflict Guard (Critical)
1. Create a proposal against a session.
2. Manually edit same session.
3. Attempt to apply older proposal.

Expected:
- System blocks apply with conflict message (stale proposal).
- No partial mutation occurs.

### C7. Undo Checkpoint (Critical)
1. Apply a proposal and publish.
2. From timeline, create undo proposal.
3. Review diff and apply undo proposal.
4. Publish again.

Expected:
- Undo proposal is generated successfully.
- Post-undo publish restores prior state for targeted changes.

### C8. Publish & Republish (Critical)
1. Publish draft plan.
2. Modify draft and republish.
3. Confirm version/snapshot updates are recorded.

Expected:
- Initial publish and republish both succeed.
- Published snapshot changes only when draft changes.

### C9. Share Weekly Draft PDF (High)
1. Use “Send weekly draft PDF”.
2. Verify coach notifications/message thread receives message.
3. Verify athlete receives message.
4. Click PDF link from message.

Expected:
- Message appears for both parties.
- PDF link is clickable and opens correctly.

### C10. Mobile Long-Press Actions (High)
1. On mobile (Chrome), long-press session tile.
2. Confirm session menu appears (publish/unpublish/copy/delete).
3. Long-press day cell (not session), confirm day-level menu appears.

Expected:
- Correct menu based on press target.
- Browser-native text selection does not override app action.

---

## Athlete UAT Script

### A1. Draft Visibility Rule (Critical)
1. Ensure a draft exists but is not published.
2. Athlete attempts to view plan data.

Expected:
- Athlete cannot see draft-only changes.

### A2. Published Plan Visibility (Critical)
1. Coach publishes plan.
2. Athlete views current plan/calendar.

Expected:
- Athlete sees currently published version only.

### A3. Republish Behavior (Critical)
1. Coach edits draft without publishing.
2. Athlete checks plan again.
3. Coach republishes.
4. Athlete checks again.

Expected:
- Before republish: athlete still sees previous published snapshot.
- After republish: athlete sees updated published snapshot.

### A4. Message + PDF Feedback Loop (High)
1. Athlete receives weekly draft PDF message.
2. Opens PDF and replies with requested changes.

Expected:
- Message thread flow is operational and coherent.

---

## Regression Spot Checks
- Coach dashboard loads without APB regressions.
- Athlete dashboard loads without APB regressions.
- Scheduling calendar retains session publish/draft color logic.
- No console/runtime errors in core APB routes.

---

## Reporting Template
Use `docs/APB_UAT_H2_RESULTS.csv`.

Required fields:
- `run_id`
- `tester_role`
- `case_id`
- `status` (`PASS` / `FAIL` / `BLOCKED`)
- `severity` (`P0` / `P1` / `P2` / `P3` / `NA`)
- `actual_result`
- `expected_result`
- `url`
- `screenshot_path`
- `notes`

