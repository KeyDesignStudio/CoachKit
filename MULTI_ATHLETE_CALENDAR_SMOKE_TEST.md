# Multi-athlete Calendar View - Smoke Test Checklist

## Overview
This document tests the new multi-athlete calendar view which allows coaches to view and manage sessions for multiple athletes across a single week in a grid layout.

## Test Scenarios

### 1. Navigation and Access
**Goal:** Verify coach can access the multi-athlete calendar

**Steps:**
1. Login as coach (Multisport Coach)
2. Look at the navigation header
3. Click "Coach · Multi-athlete Calendar"

**Expected Results:**
- ✅ Nav link visible in header
- ✅ Page loads successfully
- ✅ Page title shows "Multi-athlete Calendar"
- ✅ Week range displayed (e.g., "Week of 2026-01-06")

---

### 2. Athlete Selection - All Athletes Default
**Goal:** Verify default athlete selection behavior

**Steps:**
1. On multi-athlete calendar page, check athlete selector button
2. Look at the grid

**Expected Results:**
- ✅ Athlete selector shows "All athletes (2)" or similar count
- ✅ Grid shows rows for all coached athletes (Athlete One and Athlete Two)
- ✅ Each athlete row visible with name

---

### 3. Athlete Selection - Individual Selection
**Goal:** Verify filtering athletes works

**Steps:**
1. Click athlete selector button
2. Dropdown opens with search box and athlete list
3. See "Select all" checkbox is checked
4. Uncheck "Select all" (deselects everyone)
5. Check only "Athlete One"
6. Click outside dropdown to close

**Expected Results:**
- ✅ Dropdown shows with athlete list
- ✅ Search box functional
- ✅ "Select all" toggles all checkboxes
- ✅ Individual checkboxes work
- ✅ Selector button updates to "1 athlete"
- ✅ Grid shows only Athlete One row

---

### 4. Grid Layout - Desktop
**Goal:** Verify grid displays correctly on desktop

**Steps:**
1. Ensure window width >1024px (desktop)
2. Select all athletes
3. Look at the grid structure

**Expected Results:**
- ✅ Left sticky column shows athlete names
- ✅ 7 day columns (Mon-Sun) with dates
- ✅ Each day header shows day name + date (e.g., "Mon 6")
- ✅ Grid has rows for each athlete
- ✅ Each athlete row shows Draft/Published badge
- ✅ Badge is green for Published, amber for Draft

---

### 5. Session Chips - Display
**Goal:** Verify session chips show correct information

**Steps:**
1. Find an athlete with planned sessions in the current week
2. Look at session chips in day cells

**Expected Results:**
- ✅ Chips show time (e.g., "05:30" or "—")
- ✅ Chips show discipline icon (run/bike/swim)
- ✅ Chips show title truncated if long
- ✅ Chips have colored left border matching discipline
- ✅ Chips are compact and readable

---

### 6. Session Chips - Indicators
**Goal:** Verify indicator icons appear correctly

**Setup:**
- Have sessions with:
  - Coach advice (notes field non-empty)
  - Athlete comments (completed with comment)
  - Pain flags (completed with painFlag=true)
  - Different statuses (planned, completed, skipped)

**Steps:**
1. Look at various session chips across the grid

**Expected Results:**
- ✅ Pain flag icon (healing) shows in rose color for pain-flagged sessions
- ✅ Coach advice icon (lightbulb) shows in amber color when notes present
- ✅ Athlete comment icon (chat bubble) shows in blue when hasAthleteComment=true
- ✅ Completed icon (checkmark) shows in green for completed sessions
- ✅ Skipped icon shows in gray for skipped sessions
- ✅ Icons appear in correct order: pain → advice → comment → status
- ✅ All icons visible and not cut off

---

### 7. Click Session Chip - Opens Drawer
**Goal:** Verify clicking a session opens detail drawer

**Steps:**
1. Click any session chip in the grid
2. Drawer opens on right side

**Expected Results:**
- ✅ Drawer slides in from right
- ✅ Backdrop darkens page
- ✅ Drawer shows session title, discipline badge, status badge
- ✅ Drawer shows date and time
- ✅ Coach advice section visible if notes present
- ✅ Pain flag callout visible if painFlag=true (rose background)
- ✅ Athlete comment indicator visible if hasAthleteComment=true
- ✅ "Close" button works
- ✅ Clicking backdrop closes drawer
- ✅ "Edit in Main Calendar" button shown (for future functionality)

---

### 8. Week Navigation
**Goal:** Verify week controls work correctly

**Steps:**
1. Note current week range
2. Click "Prev" button
3. Check week range updates to previous week
4. Click "Next" button twice
5. Click "Today" button

**Expected Results:**
- ✅ "Prev" moves to previous Monday-Sunday week
- ✅ "Next" moves to next Monday-Sunday week
- ✅ "Today" jumps to week containing current date
- ✅ Week range label updates correctly
- ✅ Grid refreshes with new week's sessions
- ✅ Athlete Draft/Published badges update for new week

---

### 9. Filters - All / Comments / No Comments
**Goal:** Verify filter buttons work

**Setup:**
- Have sessions with comments and without comments

**Steps:**
1. Click "All" filter (default)
2. All sessions visible
3. Click "Comments" filter
4. Only sessions with athlete comments show
5. Click "No Comments" filter
6. Only sessions without athlete comments show

**Expected Results:**
- ✅ "All" shows all sessions (default)
- ✅ "Comments" filters to only hasAthleteComment=true
- ✅ "No Comments" filters to hasAthleteComment=false
- ✅ Active filter button has white background + shadow
- ✅ Grid updates immediately on filter change
- ✅ Athlete rows with no visible sessions disappear

---

### 10. Filters - Pain Flags
**Goal:** Verify pain flag filter works

**Setup:**
- Have at least one completed session with painFlag=true

**Steps:**
1. Click "Pain Flags" filter button

**Expected Results:**
- ✅ Only sessions with painFlag=true visible
- ✅ All other sessions hidden
- ✅ Athletes with no pain-flagged sessions disappear
- ✅ Filter button active (white background)

---

### 11. Toggle - Only With Sessions
**Goal:** Verify "Only with sessions" toggle

**Setup:**
- Have at least one athlete with no sessions in current week
- Have at least one athlete with sessions

**Steps:**
1. Uncheck "Only with sessions" (default)
2. All athletes show even if no sessions
3. Check "Only with sessions" checkbox
4. Athletes without sessions disappear

**Expected Results:**
- ✅ Unchecked: All selected athletes show (even empty rows)
- ✅ Checked: Only athletes with sessions in filtered view show
- ✅ Checkbox state persists during navigation
- ✅ Works in combination with other filters

---

### 12. Quick Add Button
**Goal:** Verify "+" add button in cells

**Steps:**
1. Find any day cell in any athlete row
2. Look for "+ Add" button at bottom of cell
3. Click "+ Add" button

**Expected Results:**
- ✅ Every day cell has "+ Add" button (dashed border)
- ✅ Button shows icon + "Add" text
- ✅ Clicking shows alert: "Add session for [Athlete Name] on [Date]"
- ✅ (Full functionality to be implemented - opens create modal prefilled)

---

### 13. Refresh Button
**Goal:** Verify refresh reloads data

**Steps:**
1. Note current sessions in grid
2. Click "Refresh" button (icon with circular arrow)

**Expected Results:**
- ✅ Button briefly shows loading state (disabled)
- ✅ Grid data refreshes
- ✅ All filters remain active
- ✅ Week range stays the same
- ✅ Athlete selection preserved

---

### 14. Draft/Published Awareness
**Goal:** Verify coach sees draft/published status per athlete

**Setup:**
- Publish week for Athlete One (use single-athlete calendar)
- Leave week as Draft for Athlete Two

**Steps:**
1. Navigate to multi-athlete calendar
2. Select both athletes
3. Look at current week grid

**Expected Results:**
- ✅ Athlete One row shows green "PUBLISHED" badge
- ✅ Athlete Two row shows amber "DRAFT" badge
- ✅ Both athletes' sessions visible (coach sees all)
- ✅ Badges update when navigating weeks
- ✅ Badges visible in both desktop grid and mobile accordion

---

### 15. Mobile View - Accordion
**Goal:** Verify mobile fallback works

**Steps:**
1. Resize browser to <1024px width OR use mobile device
2. Verify mobile view displays

**Expected Results:**
- ✅ Desktop grid hidden (no horizontal overflow)
- ✅ Mobile accordion list appears
- ✅ Each athlete is collapsible card
- ✅ Athlete name + status badge + session count visible
- ✅ Expanding athlete shows horizontal scrolling week view
- ✅ Day names shown above each column (Mon-Sun)
- ✅ Session chips same format as desktop
- ✅ "+ Add" button present in each day cell
- ✅ Clicking chip opens same drawer

---

### 16. Performance - Multiple Athletes
**Goal:** Verify performance with all athletes selected

**Steps:**
1. Select all athletes (both in demo: Athlete One + Two)
2. Navigate between weeks
3. Apply different filters

**Expected Results:**
- ✅ Page loads within 2 seconds
- ✅ No console errors
- ✅ Grid renders smoothly
- ✅ Week navigation responsive
- ✅ Filter changes instant
- ✅ No duplicate API calls (check Network tab)

---

### 17. Empty States
**Goal:** Verify empty state handling

**Steps:**
1. Navigate to a future week with no sessions
2. Apply "Pain Flags" filter when no pain flags exist
3. Deselect all athletes

**Expected Results:**
- ✅ Empty week shows athlete rows with empty cells (+ Add button only)
- ✅ Filter with no results shows: "No athletes or sessions to display"
- ✅ No athletes selected shows empty state message
- ✅ No JavaScript errors in console

---

### 18. Persist Filter Preference
**Goal:** Verify filter selection persists

**Steps:**
1. Select "Comments" filter
2. Navigate to different page (e.g., Coach Dashboard)
3. Return to multi-athlete calendar

**Expected Results:**
- ✅ Filter remains on "Comments" (saved to localStorage)
- ✅ Grid shows filtered view
- ✅ Filter button shows active state

---

### 19. Integration - Existing Calendar
**Goal:** Verify multi-calendar doesn't break single-athlete calendar

**Steps:**
1. Use multi-athlete calendar (view sessions)
2. Navigate to "Coach · Calendar" (single-athlete)
3. Verify single-athlete calendar still works
4. Create/edit session in single-athlete calendar
5. Return to multi-athlete calendar

**Expected Results:**
- ✅ Single-athlete calendar unchanged
- ✅ All functionality works in both views
- ✅ Changes in single-athlete calendar reflect in multi-athlete view
- ✅ No shared state conflicts

---

### 20. Accessibility and Icons
**Goal:** Verify all icons registered and accessible

**Steps:**
1. Look at various session chips
2. Check aria-labels on icons
3. Use screen reader (optional)

**Expected Results:**
- ✅ All icons render (no missing material-symbols)
- ✅ Icons have proper aria-labels:
  - Pain flag: "Pain flagged"
  - Coach advice: "Has coach advice"
  - Athlete comment: "Has athlete comment"
  - Completed: "Completed"
  - Skipped: "Skipped"
- ✅ Icon colors match spec (rose, amber, blue, green, gray)

---

## Known Limitations (MVP)

**Not Implemented Yet:**
- ❌ Full edit functionality in drawer (shows "Edit in Main Calendar" placeholder)
- ❌ Quick add "+" button opens create modal (shows alert placeholder)
- ❌ Drag/drop to move sessions
- ❌ Bulk operations (multi-select)
- ❌ Coach comment reply from drawer
- ❌ Filter persistence across page reloads for athlete selection
- ❌ Export/print view
- ❌ Keyboard navigation shortcuts

**Future Enhancements:**
- Inline edit (duration/distance) without opening drawer
- Color-coded workout types
- Hover preview with full details
- Copy/paste sessions between athletes
- Week comparison view

---

## Summary

**Core Functionality:**
- ✅ Multi-athlete week grid view
- ✅ Athlete selection (multi-select with search)
- ✅ Session chips with all indicators
- ✅ Click to view drawer
- ✅ Week navigation
- ✅ 4 filter modes (All, Comments, No Comments, Pain Flags)
- ✅ Draft/Published status per athlete
- ✅ Mobile accordion fallback
- ✅ Refresh data
- ✅ "Only with sessions" toggle

**Integration:**
- ✅ Reuses existing components (SessionChip, Icon, Badge)
- ✅ Reuses existing API endpoints
- ✅ Glass UI styling consistent
- ✅ No schema changes required
- ✅ Works alongside single-athlete calendar

**Ready for Production:** Yes (with placeholders for edit/add functionality)
