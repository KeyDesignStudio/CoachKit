# Strava Connect - Smoke Test Steps

## Prereqs
- Strava app created in Strava settings

## Vercel env vars (apps/web)
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- Optional: `STRAVA_REDIRECT_URI`
  - If set, CoachKit uses this exact value for Strava OAuth `redirect_uri`.
  - If not set, CoachKit derives it from:
    - Prod: `NEXT_PUBLIC_APP_URL` (must be set) + `/api/integrations/strava/callback`
    - Dev: `http://localhost:3000/api/integrations/strava/callback`

## Strava app callback URLs
- Prod callback URL:
  - `https://<your-domain>/api/integrations/strava/callback`
- Local callback URL:
  - `http://localhost:3000/api/integrations/strava/callback`

Note: If you set `STRAVA_REDIRECT_URI`, the Strava app must allow that exact URL.

## Setup
1. Start dev server: `npm run dev` (from `apps/web`)
2. Login as an athlete user
3. Navigate to `/athlete/settings`

## Test 1: Connect flow
**Expected**: Strava OAuth completes and CoachKit stores a connection.

**Steps**:
1. On `/athlete/settings`, under **Strava**, click **Connect**
2. **Verify**: Browser redirects to `strava.com` authorization screen
3. Approve the request
4. **Verify**: Redirects back to `/athlete/settings?strava=connected`
5. **Verify**: Strava card shows **Connected**
6. **Verify**: Strava athlete ID is shown

## Test 2: Cancel flow
**Expected**: Cancelling does not connect and shows a safe message.

**Steps**:
1. On `/athlete/settings`, click **Connect**
2. On Strava, click **Cancel**
3. **Verify**: Redirects back to `/athlete/settings?strava=cancelled`
4. **Verify**: Strava card shows **Not connected**

## Test 3: Disconnect
**Expected**: Connection is removed and UI updates.

**Steps**:
1. Ensure Strava shows **Connected**
2. Click **Disconnect**
3. **Verify**: Strava card shows **Not connected**

## Success Criteria
- ✅ Athlete can connect Strava via OAuth
- ✅ Tokens are never returned to the browser
- ✅ Connection status is visible in `/athlete/settings`
- ✅ Athlete can disconnect successfully
- ✅ No server errors in logs
