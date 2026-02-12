# Calendars Performance Baseline (Prod Build)

Date: 2026-02-12

## Commands

```bash
cd apps/web
npm run build
npm run start
```

Lighthouse (Chrome profile for authenticated month/week view):

```bash
# Month view
npx --yes lighthouse http://localhost:3000/coach/calendar \
  --output=json --output-path=/tmp/lh-cal-coach-month-desktop.json \
  --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/athlete/calendar \
  --output=json --output-path=/tmp/lh-cal-athlete-month-desktop.json \
  --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/coach/calendar \
  --output=json --output-path=/tmp/lh-cal-coach-month-mobile.json \
  --only-categories=performance --form-factor=mobile \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/athlete/calendar \
  --output=json --output-path=/tmp/lh-cal-athlete-month-mobile.json \
  --only-categories=performance --form-factor=mobile \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

# Week view
npx --yes lighthouse http://localhost:3000/coach/calendar \
  --output=json --output-path=/tmp/lh-cal-coach-week-desktop.json \
  --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/athlete/calendar \
  --output=json --output-path=/tmp/lh-cal-athlete-week-desktop.json \
  --only-categories=performance --preset=desktop \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/coach/calendar \
  --output=json --output-path=/tmp/lh-cal-coach-week-mobile.json \
  --only-categories=performance --form-factor=mobile \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet

npx --yes lighthouse http://localhost:3000/athlete/calendar \
  --output=json --output-path=/tmp/lh-cal-athlete-week-mobile.json \
  --only-categories=performance --form-factor=mobile \
  --chrome-flags="--headless=new --user-data-dir=$HOME/Library/Application\ Support/Google/Chrome --profile-directory=Default" --quiet
```

## Baseline Metrics (Before)

### Coach Calendar - Week

- Desktop: FCP 594 ms, LCP 910 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.
- Mobile: FCP 2638 ms, LCP 4907 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.

### Athlete Calendar - Week

- Desktop: FCP 604 ms, LCP 881 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.
- Mobile: FCP 2645 ms, LCP 4943 ms, TBT 8.5 ms, CLS 0.0, LCP element: not reported.

### Coach Calendar - Month

- Desktop: FCP 1047 ms, LCP 12154 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.
- Mobile: FCP 1707 ms, LCP 4437 ms, TBT 40 ms, CLS 0.0, LCP element: not reported.

### Athlete Calendar - Month

- Desktop: FCP 615 ms, LCP 938 ms, TBT 0 ms, CLS 0.0, LCP element: not reported.
- Mobile: FCP 1694 ms, LCP 4394 ms, TBT 52 ms, CLS 0.0, LCP element: not reported.

## Subjective Timings

- Coach calendar — Week: shell ~6.5s; grid ~7.6s.
- Coach calendar — Month: shell ~6.2s; grid ~8.0s.
- Athlete calendar — Week: shell ~6.5s; grid ~8.3s.
- Athlete calendar — Month: shell ~6.8s; grid ~7.9s.

Notes:
- LCP element is not reported in these runs (null in Lighthouse output).
