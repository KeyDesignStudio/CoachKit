# Publish/Draft Weeks - Smoke Test Steps

## Setup
1. Start dev server: `npx next dev`
2. Login as coach: `coach@multisportgold.test`
3. Navigate to Coach Calendar page

## Test 1: Draft Week (Initial State)
**Expected**: Current week shows "Draft" badge in amber/yellow
**Steps**:
1. Select "First Athlete" from dropdown
2. Observe week status badge next to "Weekly Calendar" title
3. **Verify**: Badge shows "Draft" in amber color
4. **Verify**: "Publish week" button visible (primary blue)

## Test 2: Publish Week
**Expected**: Workouts become visible to athlete after publishing
**Steps**:
1. As coach, click "Publish week" button
2. **Verify**: Badge changes to "Published" in green color
3. **Verify**: Button changes to "Unpublish week" (ghost/secondary)
4. Login as athlete: `athlete.one@multisportgold.test`
5. Navigate to Athlete Calendar
6. **Verify**: Workouts for current week are visible
7. Click on any workout card
8. **Verify**: Workout detail page loads successfully

## Test 3: Athlete Cannot See Draft Workouts
**Expected**: Draft workouts are hidden from athletes
**Steps**:
1. As coach, navigate to next week (click "Next" button)
2. Create a new workout for next week (any day)
3. **Verify**: Week status shows "Draft"
4. Login as athlete: `athlete.one@multisportgold.test`
5. Navigate to Athlete Calendar
6. Navigate to next week
7. **Verify**: Calendar shows "No published training yet" or empty week
8. As coach, try to copy the workout URL from calendar
9. As athlete, try to access the workout URL directly
10. **Verify**: 404/forbidden error (workout not accessible)

## Test 4: Unpublish Week
**Expected**: Published workouts become hidden after unpublishing
**Steps**:
1. As coach, go back to current week (with published workouts)
2. **Verify**: Status shows "Published"
3. Click "Unpublish week" button
4. **Verify**: Badge changes to "Draft"
5. Login as athlete
6. Navigate to Athlete Calendar
7. **Verify**: Previously visible workouts are now hidden
8. Try accessing a workout URL from current week directly
9. **Verify**: 404/forbidden error

## Test 5: Copy Week Creates Draft
**Expected**: Copied workouts go to draft week
**Steps**:
1. As coach, ensure current week is published
2. Click "Copy week" button
3. Set "From week" to current week
4. Set "To week" to next week (+7 days)
5. Click "Copy"
6. Navigate to next week
7. **Verify**: Week status shows "Draft"
8. **Verify**: Workouts are visible to coach
9. Login as athlete
10. Navigate to next week
11. **Verify**: Workouts are NOT visible (still draft)
12. As coach, publish next week
13. As athlete, refresh calendar
14. **Verify**: Workouts now visible

## Test 6: Month View (Athlete)
**Expected**: Only published days show workouts
**Steps**:
1. As coach, ensure current week is published, next week is draft
2. Create workouts in week after next (leave as draft)
3. Login as athlete
4. Switch to Month view
5. **Verify**: Only published week shows session chips
6. **Verify**: Draft weeks show empty day cells
7. Navigate to different months
8. **Verify**: No errors, behaves correctly

## Test 7: Review Board Still Works
**Expected**: Coach can see completed items regardless of publish state
**Steps**:
1. As athlete, complete a workout from published week
2. As coach, navigate to Review Board (Dashboard)
3. **Verify**: Completed workout appears for review
4. **Verify**: Can add coach review comment
5. As coach, unpublish the week
6. Go back to Review Board
7. **Verify**: Completed workout still visible (review access unaffected)

## Success Criteria
- ✅ All 7 tests pass without errors
- ✅ Build passes: `npx next build`
- ✅ No console errors in browser
- ✅ Week status updates immediately on publish/unpublish
- ✅ Athletes cannot access unpublished workouts via any method
- ✅ Coach can see all workouts regardless of status
