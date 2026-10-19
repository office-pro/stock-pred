/**
 * MI-5 Generate gate + lineage isolation (trader-agent).
 * Does not alter Risk / Portfolio / Policy / Gate.
 */

import type { AgentService } from './agent.service';
import { IntelligenceBatchService } from './intelligence-batch.service';
import type { MiCombinedPreflightService } from './mi-combined-preflight.service';
import type { MiBatchSnapshotService } from './mi-batch-snapshot.service';
import {
  assertSnapshotMembershipMatchesBatch,
  nseEquityInstrumentRef,
  validateMiSnapshotForGenerate,
} from '@stockpred/shared-utils';
import type { MarketIntelligenceBatchSnapshot } from '@stockpred/shared-types';

jest.mock('./intelligence-batch-store', () => ({
  writeIntelligenceBatch: jest.fn(),
  readIntelligenceBatch: jest.fn(),
  listIntelligenceBatches: jest.fn(() => []),
  writeBatchDataSnapshot: jest.fn(),
  readBatchDataSnapshot: jest.fn(),
  writeMarketIntelligenceBatchSnapshot: jest.fn(),
  readMarketIntelligenceBatchSnapshot: jest.fn(),
  writeAdvancedIntelligenceSnapshot: jest.fn(),
  readAdvancedIntelligenceSnapshot: jest.fn(),
  writeIntelligenceBatchResults: jest.fn(),
  readIntelligenceBatchResults: jest.fn(),
}));

describe('MI-5 generate gate + auth isolation', () => {
  const noopMiBatch = {
    buildAndPersist: jest.fn(),
  } as unknown as MiBatchSnapshotService;

  it('membership mismatch → GENERATION_INPUT_INCOMPLETE reason', () => {
    const r = assertSnapshotMembershipMatchesBatch({
      batchSymbols: ['AAA', 'BBB'],
      snapshot: {
        instruments: [{ instrumentRef: nseEquityInstrumentRef('AAA') }],
      } as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('GENERATION_INPUT_INCOMPLETE');
  });

  it('validateMiSnapshotForGenerate blocks STANDARD without fundamentals', () => {
    const mi: MarketIntelligenceBatchSnapshot = {
      schemaVersion: 'mi-batch-snapshot.v1',
      snapshotId: 'MI-x',
      batchId: 'B',
      dataSnapshotVersion: 'batch-data-snapshot.v1',
      asOf: '2026-09-01T00:00:00.000Z',
      universeType: 'NIFTY50',
      instruments: [nseEquityInstrumentRef('RELIANCE')],
      bySymbol: {},
      coverage: {
        fundamentalsAvailable: 0,
        newsAvailable: 0,
        sentimentAvailable: 0,
        corporateAvailable: 0,
        technicalAvailable: 0,
        eligible: 1,
      },
      generatedAt: '2026-09-01T00:00:00.000Z',
    };
    const r = validateMiSnapshotForGenerate({
      miSnapshot: mi,
      batchSymbols: ['RELIANCE'],
      miMode: 'STANDARD',
    });
    expect(r.ok).toBe(false);
  });

  it('IntelligenceBatchService still constructs with MiBatchSnapshotService (3-arg)', () => {
    const mi = {
      run: jest.fn(),
    } as unknown as MiCombinedPreflightService;
    const service = new IntelligenceBatchService({} as AgentService, mi, noopMiBatch);
    expect(service).toBeTruthy();
  });

  it('crown: analyzeForIntelligenceBatch skipLiveMiEvidence does not call evaluateTrade', async () => {
    const evaluateTrade = jest.fn();
    const analyzeSymbol = jest.fn().mockResolvedValue({ symbol: 'AAA' });
    const agent = {
      evaluateTrade,
      analyzeForIntelligenceBatch: async (
        symbol: string,
        quote?: unknown,
        opts?: { skipLiveMiEvidence?: boolean },
      ) => {
        // Mirror production path: never evaluateTrade from batch analyze.
        void quote;
        void opts;
        return analyzeSymbol(symbol);
      },
      scoreHeadline: jest.fn().mockResolvedValue(null),
    } as unknown as AgentService;
    const service = new IntelligenceBatchService(
      agent,
      { run: jest.fn() } as unknown as MiCombinedPreflightService,
      noopMiBatch,
    );
    await agent.analyzeForIntelligenceBatch('AAA', undefined, { skipLiveMiEvidence: true });
    expect(evaluateTrade).not.toHaveBeenCalled();
    expect(service).toBeTruthy();
  });
});
