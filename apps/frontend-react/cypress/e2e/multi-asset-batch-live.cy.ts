describe('Multi-Asset Batch live provider chain', () => {
  beforeEach(() => {
    cy.request('POST', '/api/auth/login', {
      email: 'user@stockpred.local',
      password: 'User@12345',
    }).then(({ body }) => {
      window.localStorage.setItem(
        'stockpred.auth',
        JSON.stringify({
          user: body.user,
          accessToken: body.tokens.accessToken,
          refreshToken: body.tokens.refreshToken,
        }),
      );
    });
  });

  it('renders real canonical NSE membership and backend status responsively', () => {
    cy.viewport(1440, 1000);
    cy.visit('/batch');
    cy.get('[data-testid="overview-new-batch"]', { timeout: 30_000 }).click();
    cy.contains('NSE F&O')
      .parents('.MuiCard-root')
      .contains(/\d[\d,]* symbols/)
      .should('be.visible');
    cy.contains('button', 'Next: Configure').click();
    cy.contains('Configure Analysis').should('be.visible');
    cy.screenshot('multi-asset-live-desktop', { capture: 'viewport' });

    cy.viewport(900, 1100);
    cy.contains('Configure Analysis').should('be.visible');
    cy.screenshot('multi-asset-live-tablet', { capture: 'viewport' });

    cy.contains('button', 'Next: Review & Run').click();
    cy.viewport(390, 844);
    cy.contains('Run Batch Analysis').scrollIntoView().should('be.visible');
    cy.screenshot('multi-asset-live-mobile', { capture: 'viewport' });
  });
});
