import { test, expect } from '@playwright/test';

test.describe('Kaggle loader (HTTP CSV)', () => {
  test('CSV parse success', async ({ page, baseURL }) => {
    const response = await page.request.post('/api/test/kaggle-loader', {
      data: { url: `${baseURL}/api/test/kaggle-fixtures/good.csv` },
    });

    expect(response.status()).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.error).toBeNull();
    expect(payload.data.ok).toBe(true);
    expect(payload.data.format).toBe('csv');
    expect(payload.data.rowCount).toBeGreaterThan(0);
  });

  test('CSV parse failure returns KAGGLE_PARSE_FAILED', async ({ page, baseURL }) => {
    const response = await page.request.post('/api/test/kaggle-loader', {
      data: { url: `${baseURL}/api/test/kaggle-fixtures/bad.csv` },
    });

    expect(response.status()).toBe(400);
    const payload = (await response.json()) as any;
    expect(payload.data).toBeNull();
    expect(payload.error.code).toBe('KAGGLE_PARSE_FAILED');
    expect(payload.error.requestId).toBeTruthy();
    expect(payload.error.httpStatus).toBe(400);
  });

  test('Non-200 fetch returns KAGGLE_FETCH_FAILED with status', async ({ page, baseURL }) => {
    const response = await page.request.post('/api/test/kaggle-loader', {
      data: { url: `${baseURL}/api/test/kaggle-fixtures/missing.csv` },
    });

    expect(response.status()).toBe(502);
    const payload = (await response.json()) as any;
    expect(payload.data).toBeNull();
    expect(payload.error.code).toBe('KAGGLE_FETCH_FAILED');
    expect(payload.error.requestId).toBeTruthy();
    expect(payload.error.httpStatus).toBe(502); // API error status
    expect(String(payload.error.message)).toContain('status=404'); // Upstream Kaggle status
  });
});
