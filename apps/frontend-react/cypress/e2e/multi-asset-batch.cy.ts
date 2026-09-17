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
  sourceCount: 2123,
  membershipSource: 'NSE reference data',
  universeVersion: 'test-version',
  lifecycle: 'PUBLISH',
  validationStatus: 'COMPLETE',
  analysisOptions: {
    timeframes: ['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'],
    analysisPeriods: ['1W', '1M', '3M', '6M', '1Y', 'CUSTOM'],
    analysisResolutions: ['1D'],
    horizons: [
      { id: '1D', label: '1 Day' },
      { id: '1W', label: '1 Week' },
      { id: '1M', label: '1 Month' },
      { id: '3M', label: '3 Months' },
    ],
    modes: [{ id: 'HISTORICAL', label: 'Standard' }],
    priorities: [],
  },
};

const cryptoSpot = {
  ...nseAll,
  universeId: 'CRYPTO_SPOT_ALL',
  name: 'Crypto Spot All',
  description: 'Eligible crypto spot pairs',
  group: 'CRYPTO',
  assetClass: 'CRYPTO_SPOT',
  venue: 'BINANCE',
  instrumentCount: 80,
};

const coverage = [
  {
    capability: 'marketData',
    group: 'data',
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
    group: 'intelligence',
    status: 'UNAVAILABLE',
    eligible: 80,
    available: 0,
    partial: 0,
    unavailable: 80,
    pending: 0,
    na: 0,
    coveragePct: 0,
    reason: 'No fundamentals provider for crypto spot',
  },
  {
    capability: 'news',
    group: 'intelligence',
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
    group: 'derivatives',
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

function auth(window: Window): void {
  window.localStorage.setItem(
    'stockpred.auth',
    JSON.stringify({
      user: { id: 'test', name: 'Test', role: 'ADMIN', status: 'ACTIVE' },
      accessToken: 'test-token',
      refreshToken: 'test-token',
    }),
  );
}

describe('Multi-Asset Batch workstation', () => {
  beforeEach(() => {
    cy.intercept('GET', '**/api/agent/multi-asset/universes*', {
      universes: [
        nseAll,
        {
          ...nseAll,
          universeId: 'US_ALL',
          name: 'US All',
          group: 'US',
          venue: 'US',
          supported: false,
          instrumentCount: undefined,
          reasonCode: 'UNSUPPORTED_UNIVERSE',
          reason: 'Canonical US universe source is not currently configured.',
        },
        cryptoSpot,
        {
          ...nseAll,
          universeId: 'CUSTOM',
          name: 'Custom',
          group: 'CUSTOM',
          kind: 'CUSTOM',
          venue: 'MULTI',
          requiresManualInstruments: true,
          instrumentCount: undefined,
        },
      ],
    });
    cy.intercept('GET', '**/api/agent/multi-asset/readiness*', {
      universe: nseAll,
      dataSources: [
        {
          id: 'nse-ref',
          label: 'NSE reference data',
          capability: 'marketData',
          capabilityState: 'AVAILABLE',
          dataStatus: 'HISTORICAL',
          provider: 'NSE',
          productionCertified: true,
        },
      ],
      generatedAt: Date.now(),
    });
    cy.intercept('GET', '**/api/market/session-state*', {
      nse: { venue: 'NSE', status: 'CLOSED', dataStatus: 'HISTORICAL' },
      sessions: [{ venue: 'NSE', status: 'CLOSED', liveLabel: 'CLOSED', dataStatus: 'HISTORICAL' }],
      note: 'test',
    });
    cy.intercept('GET', '**/api/agent/intelligence-batches*', []);
    cy.intercept('GET', '**/api/agent/mode*', { mode: 'PAPER' });
    cy.intercept('GET', '**/api/agent/intelligence-batches/IBATCH-TEST/results*', {
      batchId: 'IBATCH-TEST',
      rankings: [
        {
          rank: 1,
          symbol: 'ETHUSDT',
          opportunityId: 'ETHUSDT',
          sector: 'Not available',
          instrument: { symbol: 'ETHUSDT', venue: 'BINANCE', assetClass: 'CRYPTO_SPOT' },
          recommendation: 'APPROVE',
          reason: 'backend reason',
          quarantined: false,
        },
        {
          rank: 2,
          symbol: 'NSE:BTCUSDT',
          opportunityId: 'LEAK',
          exchange: 'NSE',
          instrument: { symbol: 'BTCUSDT', venue: 'NSE', assetClass: 'CRYPTO_SPOT' },
          recommendation: 'APPROVE',
          reason: 'should not render',
          quarantined: true,
          quarantineStatus: 'IDENTITY_MISMATCH',
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
    });
    cy.intercept('GET', '**/api/agent/intelligence-batches/IBATCH-TEST/research-report*', {
      available: true,
      report: { capabilityCoverage: coverage },
    });
    cy.intercept('GET', '**/api/agent/intelligence-batches/IBATCH-TEST*', {
      batchId: 'IBATCH-TEST',
      universe: 'CRYPTO_SPOT_ALL',
      status: 'COMPLETED',
      lifecycleStage: 'FINALIZING',
      startedAt: Date.now() - 60_000,
      completedAt: Date.now(),
      capabilityCoverage: coverage,
      identityCounts: { eligible: 80, valid: 79, quarantined: 1 },
      dataReadinessReport: {
        readiness: 'READY_PARTIAL',
        eligible: 80,
        processed: 79,
        coveragePct: 0.9,
      },
    });
  });

  it('walks the wizard with Analysis Period and Analysis Resolution', () => {
    cy.visit('/batch/multi-asset', { onBeforeLoad: auth });
    cy.contains('Select Universe').should('exist');
    cy.contains('label', 'Analysis timeframe').should('not.exist');
    cy.contains('button', 'Next').click();
    cy.contains('Configure Analysis').should('exist');
    cy.contains('label', 'Analysis Period').should('exist');
    cy.contains('label', 'Analysis Resolution').should('exist');
    cy.contains('3 Months').should('exist');
    cy.contains('label', 'Analysis Period')
      .closest('.MuiFormControl-root')
      .find('[role="combobox"]')
      .click();
    cy.contains('[role="option"]', '1 Week').should('exist');
    cy.contains('[role="option"]', '1 Day').should('not.exist');
    cy.contains('[role="option"]', 'Custom').click();
    cy.contains('label', 'Start date').should('exist');
    cy.contains('label', 'End date').should('exist');
    cy.contains('button', 'Next').click();
    cy.contains('Review & Run').should('exist');
    cy.contains('Run Batch Analysis').should('exist');
    cy.contains('Save Draft').should('exist');
  });

  it('does not show manual instrument input for NSE_ALL', () => {
    cy.visit('/batch/multi-asset', { onBeforeLoad: auth });
    cy.contains('NSE ALL').should('exist');
    cy.contains('label', 'Find canonical instruments').should('not.exist');
    cy.contains('button', 'Next').click();
    cy.contains('button', 'Next').click();
    cy.contains('No instruments are sent').should('exist');
    cy.contains('label', 'Find canonical instruments').should('not.exist');
  });

  it('keeps unsupported US All visibly unavailable', () => {
    cy.visit('/batch/multi-asset', { onBeforeLoad: auth });
    cy.get('[role="tab"]').contains(/^US$/).click();
    cy.contains('US All').should('exist');
    cy.contains('Not available').should('exist');
    cy.contains('Canonical US universe source is not currently configured.').should('exist');
  });

  it('shows canonical search only in Custom configure', () => {
    cy.visit('/batch/multi-asset', { onBeforeLoad: auth });
    cy.get('[role="tab"]')
      .contains(/^Custom$/)
      .click();
    cy.contains('button', 'Next').click();
    cy.contains('label', 'Find canonical instruments').should('exist');
  });

  it('renders frozen crypto identity, excludes quarantined rows, and keeps N/A distinct from UNAVAILABLE', () => {
    cy.visit('/batch/multi-asset', {
      onBeforeLoad(window) {
        auth(window);
        window.sessionStorage.setItem('multiAsset.selectedBatchId', 'IBATCH-TEST');
      },
    });
    cy.contains('Batch Analysis Completed').should('exist');
    cy.contains('UNAVAILABLE').should('exist');
    cy.contains('N/A').should('exist');
    cy.contains('PENDING').should('exist');
    cy.get('[data-testid="coverage-status-fundamentals"]').should('contain', 'UNAVAILABLE');
    cy.get('[data-testid="coverage-status-derivatives"]').should('contain', 'N/A');
    cy.get('[data-testid="coverage-status-news"]').should('contain', 'PENDING');
    cy.get('[role="tab"]').contains('Results').click();
    cy.contains('ETHUSDT').should('exist');
    cy.contains('CRYPTO_SPOT').should('exist');
    cy.contains('backend reason').should('exist');
    cy.contains('NSE:BTCUSDT').should('not.exist');
    cy.contains('should not render').should('not.exist');
  });

  it('keeps the workflow usable at desktop, tablet, and mobile widths', () => {
    cy.visit('/batch/multi-asset', { onBeforeLoad: auth });
    cy.viewport(1440, 1000);
    cy.contains('Select Universe').should('be.visible');
    cy.contains('button', 'Next').click();

    cy.viewport(900, 1100);
    cy.contains('Configure Analysis').should('be.visible');
    cy.contains('button', 'Next').click();

    cy.viewport(390, 844);
    cy.contains('Run Batch Analysis').scrollIntoView().should('be.visible');
  });
});
