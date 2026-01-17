# Session Builder (Coach)

This doc describes the Coach Session Builder surface and its relationship to the Workout Library.

## Purpose

- Create reusable group sessions (templates) that can be applied to athletes/squads.
- Support injecting curated workouts from the Workout Library into a new session.

## Key URLs

- Session Builder (Group Sessions): `/coach/group-sessions`
- Coach Calendar (scheduled workouts): `/coach/calendar`

## Core flow

1) Create or edit a Group Session in `/coach/group-sessions`.
2) Apply the Group Session to one or more athletes (creates Calendar Items).
3) Edit the resulting scheduled workout in `/coach/calendar` (drawer).

## Workout Library integration (Phases 5–6)

How a coach uses it:

1) Go to `/coach/group-sessions` → Library tab.
2) Search/filter and preview a library workout.
3) Optional: Favorite a workout; view it later in Favorites.
4) Click “Use in Session Builder” to prefill a new Group Session.
5) Create the session, then Apply to athletes.

What is preserved when injecting:

- Instructions text
- Distance/intensity targets
- Tags and equipment
- Workout structure (JSON)
- Notes

Persistence model:

- Injected library fields are stored on the Group Session so they survive Apply.
- Apply copies those fields to the Calendar Item.
- The athlete workout detail page renders the “Workout Detail” section from the Calendar Item.

## Guardrails

- Coaches cannot create/edit library sessions; only ADMIN can write library content.
- No Strava sync/draft/confirm logic should be changed as part of Workout Library work.
