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
    cy.contains('NSE ALL', { timeout: 30_000 })
      .parents('.MuiCard-root')
      .contains(/\d[\d,]* eligible/)
      .should('be.visible');
    cy.contains('No instruments are sent').should('be.visible');
    cy.screenshot('multi-asset-live-desktop', { capture: 'viewport' });

    cy.viewport(900, 1100);
    cy.contains('Configure analysis').should('be.visible');
    cy.screenshot('multi-asset-live-tablet', { capture: 'viewport' });

    cy.viewport(390, 844);
    cy.contains('Run batch').scrollIntoView().should('be.visible');
    cy.screenshot('multi-asset-live-mobile', { capture: 'viewport' });
  });
});
