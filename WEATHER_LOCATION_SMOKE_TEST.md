# Weather Location Smoke Test

Goal: verify the new **Weather location** settings UX works without requiring users to manually enter latitude/longitude.

## Preconditions
- You can sign in as an athlete.
- Athlete has an AthleteProfile row (created on first use).

## Checks

### 1) Existing users (backward compatibility)
1. Open `/athlete/settings`.
2. Confirm the **Weather location** card loads without errors.
3. If the account already had a saved default location, confirm it shows as “Using: …” and weather continues working on workout detail and calendar tooltips.

### 2) Search + select
1. In **Weather location**, type `Brisbane` (or another city).
2. Verify a dropdown appears after a short delay (~300ms) and shows up to 8 results.
3. Click a result like `Brisbane, Queensland, AU`.
4. Verify it saves immediately and “Using: Brisbane, Queensland, AU” is shown.
5. Open any workout detail page and confirm weather loads using the stored lat/lon.

### 3) Use my current location
1. Click **Use my current location**.
2. When prompted, allow location access.
3. Verify the location saves immediately and shows “Using: …”.

Permission denied path:
1. Click **Use my current location**.
2. Deny the browser permission.
3. Verify an inline message appears: `Location permission denied`.

### 4) Advanced manual override
1. Expand **Advanced**.
2. Enter a valid latitude + longitude.
3. Verify it saves without requiring any additional “Save” click.
4. Confirm the saved location name is not automatically cleared by minor manual lat/lon edits.

### 5) Clearing
1. Click **Clear**.
2. Verify weather location is cleared (shows “Not set.”) and the app continues to load without errors.

## Network expectations
- Search uses internal endpoint: `GET /api/geocode?q=...` (debounced, only when q length >= 2).
- “Use my current location” uses: `GET /api/reverse-geocode?lat=...&lon=...`.
- Weather queries use stored lat/lon only (no free-text weather lookups).
