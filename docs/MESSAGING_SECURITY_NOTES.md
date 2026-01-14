# Messaging Security Notes

This doc summarizes the messaging endpoints, role requirements, ownership enforcement, and caching behavior.

## Endpoints

### GET /api/messages/threads
- Role: COACH or ATHLETE
- COACH: returns threads for the coach (each thread includes athlete identity and unread count for coach)
- ATHLETE: returns a single thread (athlete ↔ coach) if it exists, else an empty list

### GET /api/messages/threads/[threadId]
- Role: COACH or ATHLETE
- Returns: last 50 messages (oldest → newest) for the thread

### POST /api/messages/send
- Role: COACH or ATHLETE
- Body: `{ body: string, recipients?: { athleteIds: string[] } | { allAthletes: true } }`
- ATHLETE: sends to their coach (single thread)
- COACH: sends to one or many athletes (broadcast creates/uses a per-athlete thread)

### POST /api/messages/mark-read
- Role: COACH or ATHLETE
- Body: `{ threadId: string }`
- COACH: marks athlete-sent messages in thread as read by coach (`coachReadAt`)
- ATHLETE: marks coach-sent messages in thread as read by athlete (`athleteReadAt`)

### POST /api/messages/mark-reviewed
- Role: COACH only
- Body: `{ threadId: string, upToMessageId?: string }`
- COACH: marks athlete-sent messages in thread as reviewed (`coachReviewedAt`)

## Ownership enforcement

Ownership is enforced server-side on every thread-scoped operation:
- For COACH requests, the thread must have `coachId` matching the authenticated coach.
- For ATHLETE requests, the thread must have `athleteId` matching the authenticated athlete.

For sends:
- ATHLETE: the coach recipient is derived from the athlete profile (no arbitrary coach/thread selection).
- COACH: recipient athlete IDs are validated to be owned by the coach before message creation.

## Caching

Only GET endpoints are cached:
- `GET /api/messages/threads`
- `GET /api/messages/threads/[threadId]`

Caching is safe because responses are marked:
- `Cache-Control: private, max-age=30`
- `Vary: Cookie`

This prevents shared/proxy caching across users and ensures user-specific data is not served to other accounts.

## Cross-user data exposure

- Thread listing and message retrieval are filtered by authenticated user role + ownership.
- There is no endpoint that returns messages by athleteId/coachId without validating ownership.
- All message bodies and participants returned are scoped to the requesting user’s threads.
