import { expect, test } from '@playwright/test';
import { loginAs, openBatchWorkstation } from './helpers/auth';
import { runLiveUniverse, startNewBatch } from './helpers/batch';

async function hold(page: import('@playwright/test').Page, ms = 1_200): Promise<void> {
  await page.waitForTimeout(ms);
}

test.describe('Batch demo video (live)', () => {
  test('login roles, live NIFTY500 run, then another universe', async ({ page }) => {
    test.setTimeout(30 * 60_000);

    await loginAs(page, 'admin');
    await hold(page);
    await page.getByTestId('logout-button').click();

    await loginAs(page, 'superadmin');
    await hold(page);
    await page.getByTestId('logout-button').click();

    await loginAs(page, 'user');
    await hold(page);
    await page.getByTestId('logout-button').click();

    await loginAs(page, 'viewer');
    await hold(page);
    await page.goto('/batch');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await hold(page, 1_500);
    await page.getByTestId('logout-button').click();

    await loginAs(page, 'admin');
    await openBatchWorkstation(page);
    await hold(page);
    await startNewBatch(page);
    await hold(page);
    const niftyId = await runLiveUniverse(page, 'NIFTY500');
    expect(niftyId, 'NIFTY500 was not available on the live catalog').toBeTruthy();
    expect(niftyId).toMatch(/^IBATCH-/);
    expect(niftyId).not.toMatch(/IBATCH-E2E-/);
    await hold(page, 2_000);

    await page.getByRole('button', { name: '+ New Batch' }).click();
    await expect(page.getByTestId('screen-select-universe')).toBeVisible();
    await hold(page);
    const cryptoId = await runLiveUniverse(page, 'CRYPTO_SPOT_ALL');
    if (cryptoId) {
      expect(cryptoId).toMatch(/^IBATCH-/);
      expect(cryptoId).not.toMatch(/IBATCH-E2E-/);
      await hold(page, 2_000);
    }
  });
});
