# Athlete Calendar Sync (Private iCal Subscription)

CoachKit can publish your planned + completed workouts as a private iCal feed (`.ics`) so you can subscribe from Apple Calendar, Google Calendar, or Outlook.

This is **read-only** (subscription). Calendar apps will periodically refresh the feed.

## Get your subscribe link

In CoachKit:
- Go to **Athlete → Settings → Calendar Sync**
- Copy the **Subscribe link**

If you ever need to invalidate the link, use **Reset link** (you will need to re-subscribe in your calendar app).

## Add to Apple Calendar (iPhone / Mac)

- iPhone/Mac: **Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar**
- Paste the CoachKit subscribe link

## Add to Google Calendar (Web)

- Google Calendar (Web): **Other calendars → From URL**
- Paste the CoachKit subscribe link

## Add to Outlook

- Outlook: **Add calendar → Subscribe from web**
- Paste the CoachKit subscribe link

## Notes

- Calendar apps may refresh every **15 minutes to a few hours**.
- After you create/edit a workout in CoachKit, it will appear in the feed immediately, but your calendar app may take time to refresh.

## Troubleshooting

- **401/Unauthorized**: the link is invalid (often because it was reset). Get a fresh link in CoachKit and re-subscribe.
- **Not updating**: wait for your calendar provider to refresh, or remove/re-add the subscription.
- **Missing workouts**: deleted workouts are intentionally excluded from the feed.
