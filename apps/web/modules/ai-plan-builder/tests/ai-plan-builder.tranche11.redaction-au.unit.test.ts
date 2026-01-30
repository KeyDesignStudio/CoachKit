import { describe, expect, it } from 'vitest';

import { redactAiJsonValue } from '@/modules/ai-plan-builder/ai/providers/env';

describe('AI Plan Builder v1 (Tranche 11B: AU redaction)', () => {
  it('redacts AU mobile numbers with common formats', () => {
    expect(redactAiJsonValue('Call me on 0412 345 678')).toContain('[REDACTED_PHONE_AU]');
    expect(redactAiJsonValue('Call me on 0412-345-678')).toContain('[REDACTED_PHONE_AU]');
    expect(redactAiJsonValue('Call me on +61 412 345 678')).toContain('[REDACTED_PHONE_AU]');
    expect(redactAiJsonValue('Call me on +61 (4)12 345 678')).toContain('[REDACTED_PHONE_AU]');
  });

  it('redacts AU landline numbers with common formats', () => {
    expect(redactAiJsonValue('Office: (02) 1234 5678')).toContain('[REDACTED_PHONE_AU]');
    expect(redactAiJsonValue('Office: 07 1234 5678')).toContain('[REDACTED_PHONE_AU]');
    expect(redactAiJsonValue('Office: +61 3 1234 5678')).toContain('[REDACTED_PHONE_AU]');
  });

  it('does not over-redact common year-like numbers', () => {
    expect(redactAiJsonValue('Race is in 2026 and 2027')).toBe('Race is in 2026 and 2027');
  });

  it('redacts AU addresses conservatively (street + state)', () => {
    expect(redactAiJsonValue('12 Smith St, Fitzroy VIC 3065')).toContain('[REDACTED_ADDRESS_AU]');
    expect(redactAiJsonValue('1/23 George Street Sydney NSW 2000')).toContain('[REDACTED_ADDRESS_AU]');
    expect(redactAiJsonValue('5 Example Rd Suburbia QLD 4000')).toContain('[REDACTED_ADDRESS_AU]');
    expect(redactAiJsonValue('101 Test Crescent Hobart TAS 7000')).toContain('[REDACTED_ADDRESS_AU]');
  });

  it('avoids redacting non-address phrases without state abbreviation', () => {
    expect(redactAiJsonValue('Meet at 12 Smith St tomorrow')).toBe('Meet at 12 Smith St tomorrow');
  });
});
