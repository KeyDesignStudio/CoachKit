# Multi-Device Sync Scaffold (Phase 18.2)

This scaffold introduces GARMIN, WAHOO, and COROS integration routes, shared OAuth flow helpers, and webhook intake storage.

## New provider routes

Per provider (`garmin`, `wahoo`, `coros`):

- `GET /api/integrations/<provider>/connect`
- `GET /api/integrations/<provider>/callback`
- `POST /api/integrations/<provider>/disconnect`
- `GET /api/integrations/<provider>/status`
- `GET /api/integrations/<provider>/health`
- `GET|POST /api/integrations/<provider>/webhook`

Global status:

- `GET /api/integrations/providers/status`

## Required env vars (per provider)

- `<PROVIDER>_CLIENT_ID`
- `<PROVIDER>_CLIENT_SECRET`
- `<PROVIDER>_AUTHORIZE_URL`
- `<PROVIDER>_TOKEN_URL`
- Optional: `<PROVIDER>_REDIRECT_URI`
- Optional: `<PROVIDER>_SCOPES`
- Optional: `<PROVIDER>_WEBHOOK_VERIFY_TOKEN`
- Optional: `<PROVIDER>_WEBHOOK_SIGNING_SECRET`
- Optional: `<PROVIDER>_WEBHOOK_SIGNATURE_HEADER`

Example prefix values:

- `GARMIN_*`
- `WAHOO_*`
- `COROS_*`

## Data models

- `ExternalConnection`
- `ExternalWebhookEvent`

These are additive and designed to support staged rollout before provider-specific sync processors are added.
