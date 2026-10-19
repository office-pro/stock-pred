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

async function mockApi(
  page: Page,
  batch?: Record<string, unknown>,
  list?: unknown[],
): Promise<void> {
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
            { ...nseAll, universeId: 'NIFTY500', name: 'NIFTY 500', instrumentCount: 500 },
            { ...nseAll, universeId: 'NIFTY50', name: 'NIFTY 50', instrumentCount: 50 },
            nseAll,
            {
              ...nseAll,
              universeId: 'US_ALL',
              name: 'US All',
              group: 'US',
              supported: false,
              reason: 'Canonical US universe source is not currently configured.',
            },
            {
              ...nseAll,
              universeId: 'CRYPTO_SPOT_ALL',
              name: 'Crypto Spot All',
              group: 'CRYPTO',
              assetClass: 'CRYPTO_SPOT',
              venue: 'BINANCE',
            },
            {
              ...nseAll,
              universeId: 'FOREX_ALL',
              name: 'Forex All',
              group: 'FOREX',
              assetClass: 'FX',
            },
            {
              ...nseAll,
              universeId: 'COMMODITY_ALL',
              name: 'Commodities',
              group: 'COMMODITIES',
              assetClass: 'COMMODITY',
            },
            {
              ...nseAll,
              universeId: 'CUSTOM',
              name: 'Custom',
              group: 'CUSTOM',
              kind: 'CUSTOM',
              requiresManualInstruments: true,
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          list ?? [
            {
              batchId: 'IBATCH-HIST',
              universe: 'NIFTY500',
              status: 'COMPLETED',
              analysisPeriod: '3M',
              analysisResolution: '1D',
              predictionHorizon: '1M',
              createdAt: Date.now() - 86_400_000,
              updatedAt: Date.now() - 86_400_000,
            },
            {
              batchId: 'IBATCH-TEST',
              universe: 'CRYPTO_SPOT_ALL',
              status: 'FAILED',
              analysisPeriod: '1Y',
              analysisResolution: '1D',
              predictionHorizon: '1D',
              createdAt: Date.now() - 3_600_000,
              updatedAt: Date.now() - 3_600_000,
            },
          ],
        ),
      });
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

async function openWorkstation(
  page: Page,
  query: { batchId?: string; view?: string } = {},
): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'stockpred.auth',
      JSON.stringify({
        user: { id: 'test', name: 'Test', role: 'ADMIN', status: 'ACTIVE' },
        accessToken: 'test-token',
        refreshToken: 'test-token',
      }),
    );
  });
  const params = new URLSearchParams();
  if (query.batchId) params.set('batchId', query.batchId);
  if (query.view) params.set('view', query.view);
  const qs = params.toString();
  await page.goto(qs ? `/batch?${qs}` : '/batch');
}

test('visual contract PNG is present before screenshot baselines', () => {
  expect(fs.existsSync(visualContract)).toBe(true);
});

test('six-screen visual contract at 1440', async ({ page }) => {
  await mockApi(page);
  await openWorkstation(page);
  await expect(page.getByTestId('screen-overview')).toBeVisible();
  await expect(page.getByTestId('overview-new-batch')).toBeVisible();
  await expect(page.getByTestId('screen-overview')).toHaveScreenshot('00-overview.png');

  await page.getByTestId('overview-new-batch').click();
  await expect(page.getByTestId('screen-select-universe')).toBeVisible();
  await expect(page.getByText('NSE Equity')).toBeVisible();
  await expect(page.getByText('BSE Equity')).toBeVisible();
  await expect(page.getByTestId('screen-select-universe')).toHaveScreenshot(
    '01-select-universe.png',
  );

  await page.getByRole('button', { name: 'Next: Configure' }).click();
  await expect(page.getByTestId('screen-configure-analysis')).toBeVisible();
  await expect(page.getByText('Historical Period')).toBeVisible();
  await expect(page.getByText('Analysis Resolution')).toBeVisible();
  await expect(page.getByTestId('screen-configure-analysis')).toHaveScreenshot(
    '02-configure-analysis.png',
  );

  await page.getByRole('button', { name: 'Next: Review & Run' }).click();
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
  await openWorkstation(page, { batchId: 'IBATCH-TEST' });
  await expect(page.getByTestId('screen-batch-progress')).toBeVisible();
  await expect(page.getByTestId('progress-stage-technical')).toHaveAttribute(
    'data-state',
    'pending',
  );
  await expect(page.getByTestId('screen-batch-progress')).toHaveScreenshot('04-batch-progress.png');
});

test('coverage and results match frozen identity contract', async ({ page }) => {
  await mockApi(page);
  await openWorkstation(page, { batchId: 'IBATCH-TEST' });
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

test('history lists backend batches and overview ignores terminal session', async ({ page }) => {
  await mockApi(page);
  await openWorkstation(page, { view: 'history' });
  await expect(page.getByTestId('screen-history')).toBeVisible();
  await expect(page.getByText('IBATCH-HIST')).toBeVisible();
  await expect(page.getByTestId('screen-history')).toHaveScreenshot('07-history.png');

  await page.addInitScript(() => {
    window.sessionStorage.setItem('multiAsset.selectedBatchId', 'IBATCH-TEST');
  });
  await page.goto('/batch');
  await expect(page.getByTestId('screen-overview')).toBeVisible();
  await expect(page.getByTestId('screen-results')).toHaveCount(0);
});

test('empty history matches the dedicated empty state', async ({ page }) => {
  await mockApi(page, undefined, []);
  await openWorkstation(page, { view: 'history' });
  await expect(page.getByTestId('screen-history-empty')).toBeVisible();
  await expect(page.getByText('No Batch History Found')).toBeVisible();
  await expect(page.getByTestId('screen-history')).toHaveScreenshot('08-history-empty.png');
});
