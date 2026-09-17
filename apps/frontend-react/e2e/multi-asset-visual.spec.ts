import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const visualContract = path.resolve(
  __dirname,
  '../../../docs/ui/multi-asset-batch-visual-contract.png',
);

const nseAll = {
  universeId: 'NSE_ALL',
  name: 'NSE ALL',
  description: 'All eligible NSE equities',
  group: 'INDIA',
  kind: 'PREDEFINED',
  assetClass: 'EQUITY',
  venue: 'NSE',
  supported: true,
  requiresManualInstruments: false,
  instrumentCount: 2123,
  analysisOptions: {
    timeframes: ['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'],
    analysisPeriods: ['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'],
    analysisResolutions: ['1D'],
    horizons: [
      { id: '1D', label: '1 Day' },
      { id: '1M', label: '1 Month' },
    ],
    modes: [{ id: 'HISTORICAL', label: 'Standard' }],
    priorities: [],
  },
};

const coverage = [
  {
    capability: 'marketData',
    status: 'AVAILABLE',
    eligible: 80,
    available: 80,
    partial: 0,
    unavailable: 0,
    pending: 0,
    na: 0,
    coveragePct: 1,
  },
  {
    capability: 'fundamentals',
    status: 'UNAVAILABLE',
    eligible: 80,
    available: 0,
    partial: 0,
    unavailable: 80,
    pending: 0,
    na: 0,
    coveragePct: 0,
  },
  {
    capability: 'news',
    status: 'PENDING',
    eligible: 80,
    available: 0,
    partial: 0,
    unavailable: 0,
    pending: 80,
    na: 0,
    coveragePct: 0,
  },
  {
    capability: 'derivatives',
    status: 'N/A',
    eligible: 0,
    available: 0,
    partial: 0,
    unavailable: 0,
    pending: 0,
    na: 80,
    coveragePct: null,
  },
];

async function mockApi(page: Page, batch?: Record<string, unknown>): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method !== 'GET' && method !== 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.includes('/api/agent/multi-asset/universes')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          universes: [
            nseAll,
            {
              ...nseAll,
              universeId: 'CRYPTO_SPOT_ALL',
              name: 'Crypto Spot All',
              group: 'CRYPTO',
              assetClass: 'CRYPTO_SPOT',
              venue: 'BINANCE',
            },
          ],
        }),
      });
      return;
    }
    if (url.includes('/api/agent/multi-asset/readiness')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ universe: nseAll, dataSources: [], generatedAt: Date.now() }),
      });
      return;
    }
    if (url.includes('/api/agent/intelligence-batches/IBATCH-TEST/results')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          batchId: 'IBATCH-TEST',
          rankings: [
            {
              rank: 1,
              symbol: 'ETHUSDT',
              opportunityId: 'ETHUSDT',
              instrument: { symbol: 'ETHUSDT', venue: 'BINANCE', assetClass: 'CRYPTO_SPOT' },
              recommendation: 'APPROVE',
              reason: 'backend reason',
            },
            {
              rank: 2,
              symbol: 'NSE:BTCUSDT',
              opportunityId: 'LEAK',
              quarantined: true,
              quarantineStatus: 'IDENTITY_MISMATCH',
              recommendation: 'APPROVE',
              reason: 'should not render',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
          sort: 'rank',
          order: 'desc',
          defaultSort: 'rank',
          rankingContextVersion: 'test',
          bullRunAvailable: false,
        }),
      });
      return;
    }
    if (url.includes('/api/agent/intelligence-batches/IBATCH-TEST')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          batch ?? {
            batchId: 'IBATCH-TEST',
            universe: 'CRYPTO_SPOT_ALL',
            status: 'COMPLETED',
            lifecycleStage: 'FINALIZING',
            startedAt: Date.now() - 60_000,
            completedAt: Date.now(),
            capabilityCoverage: coverage,
            identityCounts: { eligible: 80, valid: 79, quarantined: 1 },
            dataReadinessReport: { coveragePct: 0.9, eligible: 80, processed: 79 },
          },
        ),
      });
      return;
    }
    if (url.includes('/api/agent/intelligence-batches')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (url.includes('/api/agent/mode')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'PAPER',
          tradingEnabled: false,
          decisionMode: 'APPROVAL',
          killSwitch: false,
        }),
      });
      return;
    }
    if (url.includes('/api/market/session-state')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            { venue: 'NSE', status: 'CLOSED', liveLabel: 'CLOSED', dataStatus: 'HISTORICAL' },
          ],
          note: 'test',
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function openWorkstation(page: Page, batchId?: string): Promise<void> {
  await page.addInitScript(
    ([id]) => {
      window.localStorage.setItem(
        'stockpred.auth',
        JSON.stringify({
          user: { id: 'test', name: 'Test', role: 'ADMIN', status: 'ACTIVE' },
          accessToken: 'test-token',
          refreshToken: 'test-token',
        }),
      );
      if (id) window.sessionStorage.setItem('multiAsset.selectedBatchId', id);
    },
    [batchId ?? ''],
  );
  await page.goto('/batch/multi-asset');
}

test('visual contract PNG is present before screenshot baselines', () => {
  expect(fs.existsSync(visualContract)).toBe(true);
});

test('six-screen visual contract at 1440', async ({ page }) => {
  await mockApi(page);
  await openWorkstation(page);
  await expect(page.getByTestId('screen-select-universe')).toBeVisible();
  await expect(page.getByTestId('screen-select-universe')).toHaveScreenshot(
    '01-select-universe.png',
  );

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('screen-configure-analysis')).toBeVisible();
  await expect(page.getByLabel('Analysis Period')).toBeVisible();
  await expect(page.getByLabel('Analysis Resolution')).toBeVisible();
  await expect(page.getByTestId('screen-configure-analysis')).toHaveScreenshot(
    '02-configure-analysis.png',
  );

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('screen-review-run')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run Batch Analysis' })).toBeVisible();
  await expect(page.getByTestId('screen-review-run')).toHaveScreenshot('03-review-run.png');
});

test('progress, coverage, and results screenshots consume backend values', async ({ page }) => {
  await mockApi(page, {
    batchId: 'IBATCH-TEST',
    universe: 'CRYPTO_SPOT_ALL',
    status: 'RUNNING',
    lifecycleStage: 'DATA_HYDRATING',
    startedAt: Date.now() - 60_000,
    progress: { percent: 45, processed: 225, failed: 0 },
    dataReadinessReport: { eligible: 500, processed: 225, failed: 0, coveragePct: 0.45 },
    capabilityCoverage: coverage,
  });
  await openWorkstation(page, 'IBATCH-TEST');
  await expect(page.getByTestId('screen-batch-progress')).toBeVisible();
  await expect(page.getByTestId('progress-stage-technical')).toHaveAttribute(
    'data-state',
    'pending',
  );
  await expect(page.getByTestId('screen-batch-progress')).toHaveScreenshot('04-batch-progress.png');
});

test('coverage and results match frozen identity contract', async ({ page }) => {
  await mockApi(page);
  await openWorkstation(page, 'IBATCH-TEST');
  await expect(page.getByTestId('screen-results')).toBeVisible();
  await expect(page.getByTestId('coverage-status-fundamentals')).toHaveText('UNAVAILABLE');
  await expect(page.getByTestId('coverage-status-derivatives')).toHaveText('N/A');
  await expect(page.getByTestId('coverage-status-news')).toHaveText('PENDING');
  await expect(page.getByTestId('screen-results')).toHaveScreenshot('05-coverage.png');
  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByTestId('batch-results-table')).toContainText('ETHUSDT');
  await expect(page.getByTestId('batch-results-table')).toContainText('CRYPTO_SPOT');
  await expect(page.getByTestId('top-opportunities')).toContainText('ETHUSDT');
  await expect(page.locator('body')).not.toContainText('NSE:BTCUSDT');
  await expect(page.getByTestId('screen-results')).toHaveScreenshot('06-results.png');
});
