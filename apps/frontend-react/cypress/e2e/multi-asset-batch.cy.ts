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
        {
          ...nseAll,
          universeId: 'NIFTY500',
          name: 'NIFTY 500',
          instrumentCount: 500,
        },
        {
          ...nseAll,
          universeId: 'NIFTY50',
          name: 'NIFTY 50',
          instrumentCount: 50,
        },
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
    cy.intercept('GET', '**/api/agent/intelligence-batches?limit=*', [
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
    ]);
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
    cy.visit('/batch', { onBeforeLoad: auth });
    cy.get('[data-testid="overview-new-batch"]').click();
    cy.contains('Select Universe').should('exist');
    cy.contains('label', 'Analysis timeframe').should('not.exist');
    cy.contains('button', 'Next: Configure').click();
    cy.contains('Configure Analysis').should('exist');
    cy.contains('Historical Period').should('exist');
    cy.contains('Analysis Resolution').should('exist');
    cy.contains('3 Months').should('exist');
    cy.contains('.MuiChip-root', 'Custom').click();
    cy.contains('label', 'Start date').should('exist');
    cy.contains('label', 'End date').should('exist');
    cy.contains('button', 'Next: Review & Run').click();
    cy.contains('Review & Run').should('exist');
    cy.contains('Run Batch Analysis').should('exist');
    cy.contains('Save Draft').should('exist');
  });

  it('does not show manual instrument input for NSE F&O', () => {
    cy.visit('/batch', { onBeforeLoad: auth });
    cy.get('[data-testid="overview-new-batch"]').click();
    cy.contains('NSE F&O').click();
    cy.contains('label', 'Find canonical instruments').should('not.exist');
    cy.contains('button', 'Next: Configure').click();
    cy.contains('button', 'Next: Review & Run').click();
    cy.contains('No instruments are sent').should('exist');
    cy.contains('label', 'Find canonical instruments').should('not.exist');
  });

  it('keeps unsupported US Equities visibly unavailable', () => {
    cy.visit('/batch', { onBeforeLoad: auth });
    cy.get('[data-testid="overview-new-batch"]').click();
    cy.contains('US Equities').should('exist');
    cy.contains('Not available').should('exist');
    cy.contains('Canonical US universe source is not currently configured.').should('exist');
  });

  it('shows canonical search only in Custom configure', () => {
    cy.visit('/batch', { onBeforeLoad: auth });
    cy.get('[data-testid="overview-new-batch"]').click();
    cy.get('[role="tab"]')
      .contains(/^Custom$/)
      .click();
    cy.contains('User-selected canonical InstrumentRefs').click();
    cy.contains('button', 'Next: Configure').click();
    cy.contains('label', 'Find canonical instruments').should('exist');
  });

  it('renders frozen crypto identity, excludes quarantined rows, and keeps N/A distinct from UNAVAILABLE', () => {
    cy.visit('/batch?batchId=IBATCH-TEST', { onBeforeLoad: auth });
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

  it('opens overview by default and history from View History', () => {
    cy.visit('/batch', { onBeforeLoad: auth });
    cy.get('[data-testid="screen-overview"]').should('be.visible');
    cy.contains('button', 'View History').click();
    cy.get('[data-testid="screen-history"]').should('be.visible');
    cy.contains('IBATCH-HIST').should('exist');
    cy.contains('button', 'New Batch').click();
    cy.get('[data-testid="screen-select-universe"]').should('be.visible');
  });

  it('keeps the workflow usable at desktop, tablet, and mobile widths', () => {
    cy.visit('/batch', { onBeforeLoad: auth });
    cy.viewport(1440, 1000);
    cy.get('[data-testid="overview-new-batch"]').click();
    cy.contains('Select Universe').should('be.visible');
    cy.contains('button', 'Next: Configure').click();

    cy.viewport(900, 1100);
    cy.contains('Configure Analysis').should('be.visible');
    cy.contains('button', 'Next: Review & Run').click();

    cy.viewport(390, 844);
    cy.contains('Run Batch Analysis').scrollIntoView().should('be.visible');
  });

  it('shows empty history only when the list succeeds with no rows', () => {
    cy.intercept('GET', '**/api/agent/intelligence-batches?limit=*', []);
    cy.visit('/batch?view=history', { onBeforeLoad: auth });
    cy.get('[data-testid="screen-history-empty"]').should('contain', 'No Batch History Found');
    cy.get('[data-testid="create-first-batch"]').should('exist');
  });

  it('does not treat a history API failure as empty', () => {
    cy.intercept('GET', '**/api/agent/intelligence-batches?limit=*', {
      statusCode: 500,
      body: { message: 'fail' },
    });
    cy.visit('/batch?view=history', { onBeforeLoad: auth });
    cy.contains('Unable to load batch history').should('exist');
    cy.get('[data-testid="screen-history-empty"]').should('not.exist');
  });

  it('keeps three terminal header actions and shows APPROVE not BUY', () => {
    cy.visit('/batch?batchId=IBATCH-TEST', { onBeforeLoad: auth });
    cy.contains('button', 'View History').should('exist');
    cy.contains('button', 'Retry').should('exist');
    cy.contains('button', 'Run New Batch').should('exist');
    cy.contains('button', /^New Batch$/).should('not.exist');
    cy.get('[role="tab"]').contains('Results').click();
    cy.contains('APPROVE').should('exist');
    cy.get('[data-testid="batch-results-table"]').should('not.contain', 'BUY');
  });

  it('does not put coverage or results tables on Overview', () => {
    cy.visit('/batch', { onBeforeLoad: auth });
    cy.get('[data-testid="screen-overview"]').should('be.visible');
    cy.get('[data-testid="coverage-table"]').should('not.exist');
    cy.get('[data-testid="batch-results-table"]').should('not.exist');
  });
});
