import {
  preferBatchSnapshotValue,
  shouldFetchLiveBatchIntelligence,
} from './batch-detail-provenance';
import { displayRecommendation } from './multi-asset-batch';

describe('batch detail provenance', () => {
  it('9. batch detail uses batch snapshot evidence when batchId is present', () => {
    expect(shouldFetchLiveBatchIntelligence('IBATCH-1')).toBe(false);
    expect(preferBatchSnapshotValue(true, 0.41, 0.99)).toBe(0.41);
  });

  it('10. historical batch does not fetch or replace evidence with current live intelligence', () => {
    expect(shouldFetchLiveBatchIntelligence('IBATCH-HIST')).toBe(false);
    expect(shouldFetchLiveBatchIntelligence(undefined)).toBe(true);
    expect(shouldFetchLiveBatchIntelligence('')).toBe(true);
    expect(preferBatchSnapshotValue(true, undefined, 0.88)).toBeUndefined();
    expect(preferBatchSnapshotValue(true, null, 'LIVE_ANALOGUE')).toBeNull();
  });

  it('7. frontend semantic enum keeps APPROVE — no BUY conversion', () => {
    expect(displayRecommendation('APPROVE')).toBe('APPROVE');
    expect(displayRecommendation('REJECT')).toBe('REJECT');
    expect(displayRecommendation('WAIT')).toBe('WAIT');
    expect(displayRecommendation('WATCH')).toBe('WATCH');
    expect(displayRecommendation('BUY')).toBe('Not available');
    expect(displayRecommendation('AVOID')).toBe('Not available');
  });
});
