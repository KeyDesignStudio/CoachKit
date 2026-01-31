# Library Context Menu & Grid Fix Test Plan

## 1. Grid Overlap Fix
**Issue**: Sessions on 30 Jan were overlapping/cut off.
**Fix**: Simplified the CSS layout for athlete rows in the calendar grid. Removed nested `display: grid` in favor of `flex-col`. This ensures the row height expands naturally to fit the content (sessions), which propagates up effectively to the CSS Subgrid structure.

**Verification**:
1. Open the Coach Calendar on Desktop (md+ breakpoint).
2. Use stacked view (multiple athletes) or single athlete view.
3. Check a day with many sessions (e.g. 30 Jan) or add 5+ sessions to a single day.
4. Ensure the day column expands vertically and no sessions are cut off or overlapping the next row/border.

## 2. Inline Library Context Menu
**Issue**: "Add from Session Library" should list items inline in the context menu instead of opening the side panel.
**Fix**:
- Updated `CalendarContextMenu` to support a secondary view (`showLibraryList`).
- Updated `CoachCalendarPage` to fetch `libraryItems` (default 50 items) on load.
- Implemented `library-insert-item` handler to fetch the full session detail and insert it.

**Verification**:
1. Right-click on a day in the calendar.
2. Click "Add from Session Library".
3. **Expected**: The menu should NOT close. Instead, it should transform into a scrollable list of library templates.
4. Click on a template (e.g. "5k Run").
5. **Expected**: The menu closes, a loading state appears (briefly), and the session is added to that day for the current athlete.
6. Verify "Open full library" link at the bottom still opens the full side panel.

## Files Changed
- `apps/web/components/coach/CalendarContextMenu.tsx`: Re-implemented.
- `apps/web/app/coach/calendar/page.tsx`: Added state/fetching/handlers.
