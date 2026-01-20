# STRAVA_AUTOSYNC_RUNBOOK

## What this does

- Strava webhook: triggers a **debounced, best-effort sync** for the athlete (fast response; avoids sync storms).
- GitHub Actions (daily): runs a **backfill/reconciliation** sync (idempotent) to catch missed webhook events.
- Guarantee: every Strava activity for a connected athlete becomes calendar-visible:
  - matches planned workout → links completion to planned `CalendarItem`
  - no match → creates provider-origin `CalendarItem` (origin=STRAVA, planningStatus=UNPLANNED) and links completion

## Required Vercel env vars (Production)

Set these in Vercel → Project → Settings → Environment Variables:

- `APP_BASE_URL` (no trailing slash)
  - Example: `https://coach-kit.vercel.app`
- `STRAVA_AUTOSYNC_ENABLED`
  - `1` to enable, `0` to disable autosync quickly
- `CRON_SECRET`
  - Random string (16+ chars). Used to authorize the backfill endpoint.
- `STRAVA_WEBHOOK_VERIFY_TOKEN`
  - Random string (16+ chars). Used only for Strava webhook subscription verification.
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`

## GitHub Actions daily backfill (Hobby-safe)

This repo configures a daily workflow:

- File: `.github/workflows/strava-sync-cron.yml`
- Schedule: `0 19 * * *` (19:00 UTC)

Configure your GitHub repo:

- Secrets:
  - `COACHKIT_CRON_SECRET` (must match Vercel `CRON_SECRET`)
- Variables:
  - `COACHKIT_BASE_URL` (e.g. `https://coach-kit.vercel.app`, no trailing slash)

## Health / diagnostics endpoints

- `GET /api/integrations/strava/health`
  - Shows whether required env vars are present and pending intent stats.
- `GET /api/health/db`
  - DB connectivity check.

## Create Strava webhook subscription (copy/paste)

Replace values and run from your terminal:

```bash
curl -sS -X POST https://www.strava.com/api/v3/push_subscriptions \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data "client_id=$STRAVA_CLIENT_ID" \
  --data "client_secret=$STRAVA_CLIENT_SECRET" \
  --data "callback_url=$APP_BASE_URL/api/integrations/strava/webhook" \
  --data "verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN"
```

## Verify webhook GET handshake

```bash
curl -sS "$APP_BASE_URL/api/integrations/strava/webhook?hub.mode=subscribe&hub.verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN&hub.challenge=123"
```

Expected JSON:

```json
{"hub.challenge":"123"}
```

## Manually trigger cron (copy/paste)

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_BASE_URL/api/integrations/strava/cron?forceDays=2" \
  | head -c 4000
```

## Disable autosync quickly

Set in Vercel Production env vars:

- `STRAVA_AUTOSYNC_ENABLED=0`

Behavior:

- Cron returns `200` with `{ ok: true, disabled: true }`
- Webhook returns `200` quickly and does nothing
