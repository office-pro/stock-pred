import { readFileSync } from 'fs';
import { join } from 'path';

describe('IntelligenceBatchService recommendation eligibility contract', () => {
  const src = readFileSync(join(__dirname, 'intelligence-batch.service.ts'), 'utf8');

  it('applies snapshot recommendation eligibility without a second authorization path', () => {
    expect(src).toMatch(/evaluateBatchRecommendationEligibility/);
    expect(src).toMatch(/applyRecommendationEligibility/);
    expect(src).toMatch(/bestOpportunityEligible/);
    expect(src).not.toMatch(/evaluateTrade\(/);
  });
});
