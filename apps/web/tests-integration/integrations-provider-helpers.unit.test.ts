import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

import { verifyWebhookHmacSha256 } from '@/lib/integrations/webhook-signature';
import { parseExternalActivityId, parseExternalAthleteId, parseEventType } from '@/lib/integrations/providers';

describe('webhook signature verification', () => {
  it('accepts valid sha256 signature', () => {
    const secret = 'top-secret';
    const body = JSON.stringify({ hello: 'world' });
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

    expect(
      verifyWebhookHmacSha256({
        rawBody: body,
        secret,
        signatureHeaderValue: signature,
      })
    ).toBe(true);
  });

  it('rejects invalid signature', () => {
    expect(
      verifyWebhookHmacSha256({
        rawBody: '{}',
        secret: 'top-secret',
        signatureHeaderValue: 'bad-signature',
      })
    ).toBe(false);
  });
});

describe('provider payload parsers', () => {
  it('extracts athlete/activity IDs and event types from common payload fields', () => {
    const payload = {
      athlete: { id: 12345 },
      object_id: 67890,
      aspect_type: 'create',
    };

    expect(parseExternalAthleteId(payload)).toBe('12345');
    expect(parseExternalActivityId(payload)).toBe('67890');
    expect(parseEventType(payload)).toBe('create');
  });
});
