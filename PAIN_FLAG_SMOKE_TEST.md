# Pain Flagging Feature - Smoke Test Checklist

## Overview
This document tests the pain flagging feature which allows athletes to report pain/discomfort during workouts and ensures coaches receive proper visibility.

## Test Scenarios

### 1. Athlete Flags Pain on Workout Completion
**Goal:** Verify athlete can report pain when completing a workout

**Steps:**
1. Login as athlete (Athlete One or Athlete Two)
2. Navigate to Calendar (Week or Month view)
3. Click on a PLANNED workout for today or a past date
4. In the workout detail page, fill in completion form:
   - Duration: 60 min
   - Distance: 10 km
   - RPE: 7
5. Check the "Felt pain or discomfort during this session" checkbox
6. Optionally add "Notes to Coach": "Felt knee pain during run"
7. Click "Complete"

**Expected Results:**
- ✅ Workout marked as COMPLETED_MANUAL
- ✅ Pain flag saved with completedActivity record (painFlag=true)
- ✅ Completed view shows rose-colored callout: "Athlete reported pain or discomfort"
- ✅ Callout has healing icon (painFlag icon)

---

### 2. Athlete Completes Workout Without Pain Flag
**Goal:** Verify default behavior (no pain reported)

**Steps:**
1. Login as athlete
2. Complete a different planned workout
3. Fill metrics but DO NOT check pain checkbox
4. Click "Complete"

**Expected Results:**
- ✅ Workout marked as completed
- ✅ Pain flag is false (painFlag=false)
- ✅ NO pain callout shown in completed view
- ✅ Everything else works normally

---

### 3. Coach Sees Pain Flag in Review Board
**Goal:** Verify coach visibility of pain-flagged workouts

**Steps:**
1. Ensure Test Scenario 1 is completed (athlete flagged pain)
2. Login as coach (Multisport Coach)
3. Navigate to Review Board (Coach > Dashboard)
4. Look at the week grid for the athlete who flagged pain

**Expected Results:**
- ✅ Pain-flagged workout chip shows rose-colored healing icon (painFlag)
- ✅ Icon appears BEFORE coach advice icon (if present)
- ✅ Icon appears BEFORE athlete comment icon (if present)
- ✅ Hover shows aria-label "Pain flagged"

---

### 4. Coach Reviews Pain-Flagged Workout in Drawer
**Goal:** Verify pain details visible in review drawer

**Steps:**
1. In Review Board, click on a pain-flagged workout chip
2. Review drawer opens on right side

**Expected Results:**
- ✅ Drawer shows workout details
- ✅ "Completed" section shows rose-colored callout at top
- ✅ Callout text: "Athlete reported pain or discomfort"
- ✅ Callout has healing icon (painFlag)
- ✅ Metrics (Duration, Distance, RPE) shown below callout
- ✅ Coach can mark reviewed normally

---

### 5. Bulk Review Excludes Pain-Flagged Workouts
**Goal:** Verify pain-flagged items require individual attention

**Setup:**
- Athlete has 3 completed workouts in current week:
  - Workout A: No comments, NO pain flag ✅ (bulk reviewable)
  - Workout B: Has athlete comment, no pain flag ❌ (not bulk reviewable)
  - Workout C: No comments, HAS pain flag ❌ (not bulk reviewable)

**Steps:**
1. Login as coach
2. Navigate to Review Board
3. Click "All Items" filter (ensure all 3 workouts visible)
4. Hover over Workout A chip - quick review button (checkmark) appears
5. Hover over Workout B chip - NO quick review button (has comment)
6. Hover over Workout C chip - NO quick review button (has pain flag)

**Expected Results:**
- ✅ Only Workout A shows quick review button on hover
- ✅ Workouts B and C require opening drawer for full review
- ✅ Clicking quick review on Workout A marks it reviewed instantly
- ✅ Pain-flagged workout C still visible in board (not reviewed)

---

### 6. Review Board Filters Work with Pain Flags
**Goal:** Verify filtering logic respects pain flags

**Steps:**
1. In Review Board, ensure you have pain-flagged workouts from Test 1
2. Click filter: "All Items" - should show pain-flagged workouts
3. Click filter: "With Comments" - should filter based on comments only
4. Click filter: "Without Comments" - should show items without athlete comments (including pain-flagged ones)

**Expected Results:**
- ✅ "All Items": Shows all unreviewed completed workouts (including pain-flagged)
- ✅ "With Comments": Shows only items with athlete comments (pain flag irrelevant)
- ✅ "Without Comments": Shows items without athlete comments (may include pain-flagged)
- ✅ Pain flag icon always visible on affected items regardless of filter

---

### 7. Mobile View Shows Pain Flags
**Goal:** Verify mobile accordion view includes pain indicators

**Steps:**
1. Resize browser to mobile width (<1024px) OR use mobile device
2. Navigate to Review Board as coach
3. Expand athlete accordion who has pain-flagged workout

**Expected Results:**
- ✅ Horizontal scrolling day cards visible
- ✅ Pain-flagged workout chip shows healing icon
- ✅ Icon visible and properly sized for mobile
- ✅ Tapping chip opens drawer with pain callout

---

## Edge Cases

### 8. Skipped Workouts Cannot Have Pain Flags
**Goal:** Verify pain flag only applies to completed workouts

**Steps:**
1. Login as athlete
2. Open a planned workout
3. Click "Skip" instead of "Complete"

**Expected Results:**
- ✅ Workout marked as SKIPPED
- ✅ NO CompletedActivity created
- ✅ NO pain flag stored (skip doesn't create completedActivity)
- ✅ Workout does NOT appear in Review Board (only completed items appear)

---

### 9. Past Completions Don't Show Pain Checkbox
**Goal:** Verify pain flag is one-time at completion

**Steps:**
1. Login as athlete
2. Navigate to a workout you already completed (from earlier tests)
3. View the completed workout detail

**Expected Results:**
- ✅ Workout shows "Athlete log" in read-only mode
- ✅ Duration, Distance, RPE displayed
- ✅ Pain callout shown IF painFlag=true
- ✅ NO checkbox visible (can't change after completion)

---

## API Verification

### 10. Pain Flag Persisted to Database
**Goal:** Verify backend properly saves pain flag

**Steps:**
1. Complete Test Scenario 1 (athlete flags pain)
2. Check database directly or inspect API response:
   ```sql
   SELECT id, painFlag, durationMinutes, rpe 
   FROM "CompletedActivity" 
   ORDER BY createdAt DESC 
   LIMIT 5;
   ```

**Expected Results:**
- ✅ Record exists with painFlag=true for Test Scenario 1
- ✅ Other records have painFlag=false (default)
- ✅ Field is BOOLEAN type (not nullable)

---

## Regression Tests

### 11. Existing Workouts Still Work
**Goal:** Verify migration doesn't break existing completions

**Steps:**
1. Check any workouts completed BEFORE pain flag migration
2. View them in athlete calendar and coach review board

**Expected Results:**
- ✅ All existing completions display normally
- ✅ painFlag defaults to false for old records
- ✅ No errors in console
- ✅ Review board loads successfully

---

## Summary

**Feature Requirements Met:**
- ✅ Athlete can optionally report pain via checkbox on completion
- ✅ Pain flag persists to CompletedActivity.painFlag (Boolean, default false)
- ✅ Coach sees healing icon on review board chips
- ✅ Coach sees callout in review drawer
- ✅ Bulk review excludes pain-flagged items (require individual attention)
- ✅ No medical language used (simple "pain or discomfort")
- ✅ Minimal, lightweight implementation (binary flag only)

**Known Limitations:**
- Pain flag cannot be edited after completion (one-time)
- Skipped workouts don't support pain flags (no completedActivity)
- No free-text "pain notes" field (by design - use "notes to coach" instead)
- No historical pain analytics/dashboard (future enhancement)
