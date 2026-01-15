# Demo access

## Credentials (Clerk)
- Coach: `demo-coach@yourdomain.com`
- Athlete: `demo-athlete@yourdomain.com`

## URLs
- Sign in: `https://coach-kit.vercel.app/sign-in`
- Coach dashboard: `https://coach-kit.vercel.app/coach/dashboard`
- Athlete calendar: `https://coach-kit.vercel.app/athlete/calendar`

## How the demo accounts see seeded data
CoachKit is invite-only: users must exist in the `User` table.

On first login, the app links the Clerk user to an existing DB user in this order:
1) by `authProviderId` (Clerk `userId`)
2) fallback by `email` (first login), then sets `authProviderId`

So to map Clerk demo accounts to seeded data, we update the existing seeded `User.email` values to match the Clerk demo emails and set `authProviderId` to `NULL` so linking happens cleanly on next login.

## DB mapping helper (safe, no new data)
There is a small helper script to:
- list current `User` + `AthleteProfile` rows
- update exactly two existing users (coach + athlete) to the demo emails
- set `authProviderId = NULL` for those two rows

### 1) List seeded users
Run with your production/Neon `DATABASE_URL`:

```bash
cd apps/web
DATABASE_URL="..." node scripts/demo-linking.mjs list
```

Pick:
- a seeded `COACH` user id (record A)
- a seeded `ATHLETE` user id (record B)

### 2) Set demo emails on those seeded rows

```bash
cd apps/web
DATABASE_URL="..." node scripts/demo-linking.mjs set-emails \
  --coach-id <SEEDED_COACH_USER_ID> \
  --athlete-id <SEEDED_ATHLETE_USER_ID>
```

Defaults:
- coach email: `demo-coach@yourdomain.com`
- athlete email: `demo-athlete@yourdomain.com`

### 3) Reset linking (if you need to re-test)
Set `authProviderId` back to `NULL` for the demo emails, then sign in again.

Example SQL:

```sql
UPDATE "User" SET "authProviderId" = NULL WHERE email IN (
  'demo-coach@yourdomain.com',
  'demo-athlete@yourdomain.com'
);
```
