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
    expect(payload.error.httpStatus).toBe(502);
    expect(String(payload.error.message)).toContain('status=404');
  });

  test('Range CSV uses partial download (multiple requests)', async ({ page, baseURL }) => {
    const response = await page.request.post('/api/test/kaggle-loader', {
      data: {
        url: `${baseURL}/api/test/kaggle-fixtures/large-range.csv`,
        offsetRows: 3200,
        maxRows: 5,
      },
    });

    expect(response.status()).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.error).toBeNull();
    expect(payload.data.ok).toBe(true);
    expect(payload.data.format).toBe('csv');
    expect(payload.data.rowCount).toBe(5);
    expect(payload.data.diagnostics).toBeTruthy();
    expect(payload.data.diagnostics.usedRange).toBe(true);
    expect(payload.data.diagnostics.rangeRequests).toBeGreaterThan(1);
    expect(payload.data.diagnostics.bytesFetchedTotal).toBeGreaterThan(0);
    expect(payload.data.diagnostics.contentLength).toBeGreaterThan(payload.data.diagnostics.bytesFetchedTotal);
  });

  test('Range CSV retries transient 502 and succeeds', async ({ page, baseURL }) => {
    const runKey = `t${Date.now()}`;
    const response = await page.request.post('/api/test/kaggle-loader', {
      data: {
        url: `${baseURL}/api/test/kaggle-fixtures/flaky-range.csv?run=${encodeURIComponent(runKey)}`,
        offsetRows: 0,
        maxRows: 10,
      },
    });

    expect(response.status()).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.error).toBeNull();
    expect(payload.data.ok).toBe(true);
    expect(payload.data.format).toBe('csv');
    expect(payload.data.rowCount).toBe(10);
    expect(payload.data.diagnostics.usedRange).toBe(true);
    expect(payload.data.diagnostics.rangeRequests).toBeGreaterThanOrEqual(2);
  });
});
