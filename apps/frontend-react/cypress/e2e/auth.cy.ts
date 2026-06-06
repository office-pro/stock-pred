describe('Authentication', () => {
  it('logs in with the seeded demo trader', () => {
    cy.visit('/login');
    cy.get('[data-testid="login-email"]').clear().type('trader@stockpred.local');
    cy.get('[data-testid="login-password"]').type('Trader@12345');
    cy.get('[data-testid="login-submit"]').click();
    cy.contains('Demo Trader', { timeout: 15_000 });
  });

  it('rejects bad credentials', () => {
    cy.visit('/login');
    cy.get('[data-testid="login-email"]').clear().type('trader@stockpred.local');
    cy.get('[data-testid="login-password"]').type('wrong-password');
    cy.get('[data-testid="login-submit"]').click();
    cy.contains('Invalid credentials');
  });
});
