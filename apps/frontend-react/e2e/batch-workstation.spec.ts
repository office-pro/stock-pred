import { expect, test } from '@playwright/test';
import { loginAs, openBatchWorkstation } from './helpers/auth';
import { runLiveUniverse, startNewBatch } from './helpers/batch';

const OTHER_UNIVERSES = ['NIFTY50', 'CRYPTO_SPOT_ALL', 'FOREX_ALL'] as const;

test.describe('Multi-Asset Batch — live workstation', () => {
  test.setTimeout(20 * 60_000);

  test('superadmin can open the batch workstation', async ({ page }) => {
    await loginAs(page, 'superadmin');
    await openBatchWorkstation(page);
    await startNewBatch(page);
    await expect(page.getByTestId('universe-card-NIFTY500')).toBeVisible();
  });

  test('user role can open the batch workstation', async ({ page }) => {
    await loginAs(page, 'user');
    await openBatchWorkstation(page);
    await expect(page.getByTestId('overview-new-batch')).toBeVisible();
  });

  test('admin creates a live NIFTY500 batch, it runs, then completes', async ({ page }) => {
    await loginAs(page, 'admin');
    await openBatchWorkstation(page);
    await startNewBatch(page);
    const batchId = await runLiveUniverse(page, 'NIFTY500');
    expect(batchId, 'NIFTY500 card was not available on the live catalog').toBeTruthy();
    expect(batchId).toMatch(/^IBATCH-/);
    expect(batchId).not.toMatch(/IBATCH-E2E-/);
  });

  for (const universeId of OTHER_UNIVERSES) {
    test(`admin creates a live ${universeId} batch, it runs, then completes`, async ({ page }) => {
      await loginAs(page, 'admin');
      await openBatchWorkstation(page);
      await startNewBatch(page);
      const batchId = await runLiveUniverse(page, universeId, 12 * 60_000);
      test.skip(!batchId, `${universeId} is not available on this live catalog`);
      expect(batchId).toMatch(/^IBATCH-/);
      expect(batchId).not.toMatch(/IBATCH-E2E-/);
    });
  }
});
