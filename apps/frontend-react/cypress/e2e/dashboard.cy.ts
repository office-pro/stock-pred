describe('Market dashboard', () => {
  it('shows the compliance disclaimer on every page', () => {
    cy.visit('/');
    cy.get('[data-testid="disclaimer-banner"]').should(
      'contain.text',
      'This is not investment advice.',
    );
  });

  it('renders the stock table once market data loads', () => {
    cy.visit('/');
    cy.get('[data-testid="stock-table"]', { timeout: 30_000 }).should('exist');
    cy.get('[data-testid="stock-table"] tbody tr').should('have.length.greaterThan', 5);
    cy.contains('RELIANCE');
  });

  it('navigates to a stock detail chart', () => {
    cy.visit('/');
    cy.contains('RELIANCE', { timeout: 30_000 }).click();
    cy.url().should('include', '/stocks/RELIANCE');
    cy.get('[data-testid="candle-chart"]', { timeout: 30_000 }).should('exist');
  });
});
