import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getWeatherSummariesForRange } from '@/lib/weather-server';

describe('getWeatherSummariesForRange', () => {
  const params = {
    lat: 37.7749,
    lon: -122.4194,
    from: '2026-02-01',
    to: '2026-02-01',
    timezone: 'UTC',
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn(),
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns an empty map on 4xx responses', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await getWeatherSummariesForRange(params);

    expect(result).toEqual({});
    expect(infoSpy).toHaveBeenCalledWith('[Weather] Open-Meteo rejected request', { status: 400 });
  });
});
