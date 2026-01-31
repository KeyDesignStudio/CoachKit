const baseUrl = process.env.BASE_URL || process.env.COACHKIT_BASE_URL;
const secret = process.env.CRON_SECRET || process.env.COACHKIT_CRON_SECRET;

if (!baseUrl) {
  console.error('Missing BASE_URL (or COACHKIT_BASE_URL).');
  process.exit(2);
}

if (!secret) {
  console.error('Missing CRON_SECRET (or COACHKIT_CRON_SECRET).');
  process.exit(2);
}

const url = new URL('/api/integrations/strava/cron', baseUrl);
url.searchParams.set('mode', 'intents');
url.searchParams.set('forceDays', '1');

async function main() {
  const withSecret = await fetch(url, {
    method: 'POST',
    headers: {
      'x-cron-secret': secret,
    },
  });

  if (withSecret.status !== 200) {
    const body = await withSecret.text().catch(() => '');
    console.error('Expected 200 with x-cron-secret', { status: withSecret.status, body: body.slice(0, 2000) });
    process.exit(1);
  }

  const withoutSecret = await fetch(url, { method: 'POST' });
  if (withoutSecret.status !== 401 && withoutSecret.status !== 404) {
    const body = await withoutSecret.text().catch(() => '');
    console.error('Expected 401/404 without secret', { status: withoutSecret.status, body: body.slice(0, 2000) });
    process.exit(1);
  }

  console.log('OK: cron auth verified', {
    baseUrl,
    withSecretStatus: withSecret.status,
    withoutSecretStatus: withoutSecret.status,
  });
}

main().catch((error) => {
  console.error('Unexpected error verifying cron auth', error);
  process.exit(1);
});
