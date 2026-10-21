import { expect, type Page, type Response } from '@playwright/test';

const MI_UNIVERSES = new Set([
  'NIFTY50',
  'NIFTY100',
  'NIFTY200',
  'NIFTY500',
  'CUSTOM_NSE_1500',
  'CUSTOM',
  'NSE_ALL',
  'NSE_EQUITY_ALL',
]);

export async function startNewBatch(page: Page): Promise<void> {
  await page.getByTestId('overview-new-batch').click();
  await expect(page.getByTestId('screen-select-universe')).toBeVisible({ timeout: 60_000 });
}

export async function selectUniverse(page: Page, universeId: string): Promise<void> {
  const card = page.getByTestId(`universe-card-${universeId}`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toBeEnabled();
  await card.click();
}

/** Returns false when the catalog card is present but not runnable. */
export async function selectLiveUniverse(page: Page, universeId: string): Promise<boolean> {
  const card = page.getByTestId(`universe-card-${universeId}`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  if (await card.isDisabled()) return false;
  await card.click();
  return true;
}

export async function walkWizardToReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next: Configure' }).click();
  await expect(page.getByTestId('screen-configure-analysis')).toBeVisible();
  await page.getByRole('button', { name: 'Next: Review & Run' }).click();
  await expect(page.getByTestId('screen-review-run')).toBeVisible();
}

export async function chooseOffSessionEligibleSubset(page: Page): Promise<void> {
  await page.getByTestId('readiness-policy-select').click();
  await page.getByRole('option', { name: /Eligible subset/ }).click();
  await page.getByTestId('analysis-session-select').click();
  await page.getByRole('option', { name: /Off-session/ }).click();
  await expect(page.getByTestId('eligible-subset-info')).toBeVisible();
  await expect(page.getByTestId('off-session-info')).toBeVisible();
}

function isCreateBatchResponse(response: Response): boolean {
  const url = response.url();
  return (
    response.request().method() === 'POST' &&
    url.includes('/agent/intelligence-batches') &&
    !url.includes('/preflight')
  );
}

export async function runBatchAndCaptureId(page: Page, timeout = 5 * 60_000): Promise<string> {
  const run = page.getByTestId('run-batch-button');
  await expect(run, 'Run Batch stayed disabled — live preflight did not pass').toBeEnabled({
    timeout,
  });
  const created = page.waitForResponse(isCreateBatchResponse, { timeout });
  await run.click();
  const response = await created;
  expect(response.ok(), `Live create failed: ${response.status()} ${response.url()}`).toBeTruthy();
  const payload = (await response.json()) as { batchId?: string };
  const batchIdFromApi = payload.batchId ?? '';
  expect(batchIdFromApi, 'Live create response had no batchId').toMatch(/^IBATCH-/);
  expect(batchIdFromApi).not.toMatch(/IBATCH-E2E-/);

  await page.waitForURL(/batchId=IBATCH-/, { timeout });
  const batchId = new URL(page.url()).searchParams.get('batchId') ?? '';
  expect(batchId).toBe(batchIdFromApi);
  await expect(page.getByTestId('running-batch-id')).toContainText(batchId);
  return batchId;
}

export async function expectBatchRunning(page: Page, batchId: string): Promise<void> {
  await expect(page.getByTestId('screen-batch-progress')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('running-batch-id')).toContainText(batchId);
  await expect(page.getByTestId('batch-status-chip')).toHaveText(/QUEUED|RUNNING|Loading/, {
    timeout: 60_000,
  });
}

export async function expectBatchCompleted(
  page: Page,
  batchId: string,
  timeout = 12 * 60_000,
): Promise<void> {
  await expect(page.getByTestId('batch-status-chip')).toHaveText('Batch Completed', {
    timeout,
  });
  await expect(page.getByTestId('screen-results')).toBeVisible();
  await expect(page.getByTestId('running-batch-id')).toContainText(batchId);
  await page.getByRole('tab', { name: /Results/ }).click();
  await expect(page.getByTestId('batch-results-table')).toBeVisible({ timeout: 60_000 });
}

export async function runLiveUniverse(
  page: Page,
  universeId: string,
  completeTimeout = 12 * 60_000,
): Promise<string | null> {
  const selected = await selectLiveUniverse(page, universeId);
  if (!selected) return null;
  await walkWizardToReview(page);
  if (MI_UNIVERSES.has(universeId)) {
    await chooseOffSessionEligibleSubset(page);
  }
  const batchId = await runBatchAndCaptureId(page);
  await expectBatchRunning(page, batchId);
  await expectBatchCompleted(page, batchId, completeTimeout);
  return batchId;
}
