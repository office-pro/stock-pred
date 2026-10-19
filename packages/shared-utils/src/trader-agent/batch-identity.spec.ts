/**
 * Phase A: frozen InstrumentRef identity, IDENTITY_MISMATCH quarantine, validResults.
 */

import type {
  BatchDataSnapshot,
  BatchInstrumentData,
  InstrumentRef,
} from '@stockpred/shared-types';
import { BATCH_DATA_SNAPSHOT_VERSION } from '@stockpred/shared-types';
import {
  adapterHintFromInstrumentRef,
  adapterHintFromUniverse,
  batchInstrumentToStockQuote,
  bindFrozenResultIdentity,
  countNseValidResults,
  deriveBatchResultRecommendation,
  instrumentIdentityKey,
  instrumentRefFor,
  isValidSnapshotRow,
  annotateSnapshotIdentities,
} from './index';

function cryptoSpot(symbol = 'BTCUSDT'): InstrumentRef {
  return {
    symbol,
    assetClass: 'CRYPTO_SPOT',
    venue: 'BINANCE',
    quoteCurrency: 'USDT',
    canonicalSymbol: symbol,
    providerAssetId: symbol,
  };
}

function nseEquity(symbol = 'RELIANCE'): InstrumentRef {
  return {
    symbol,
    assetClass: 'EQUITY',
    venue: 'NSE',
    quoteCurrency: 'INR',
    canonicalSymbol: symbol,
  };
}

function row(ref: InstrumentRef, price = 100): BatchInstrumentData {
  return {
    instrumentRef: ref,
    quote: { price },
    dataStatus: 'AVAILABLE',
    dataAsOf: 1,
  };
}

function snapshot(universeId: string, instruments: BatchInstrumentData[]): BatchDataSnapshot {
  return annotateSnapshotIdentities({
    schemaVersion: BATCH_DATA_SNAPSHOT_VERSION,
    batchId: 'b1',
    universeId,
    provider: 'binance-spot',
    providerSelectionReason: 'test',
    instruments,
    dataAsOf: 1,
    createdAt: 1,
    coverage: {
      readiness: 'READY',
      eligible: instruments.length,
      processed: instruments.length,
      available: instruments.length,
      partial: 0,
      unavailable: 0,
      failed: 0,
      pending: 0,
      marketDataAvailable: instruments.length,
      historicalAvailable: 0,
      derivativesAvailable: 0,
      requiredCapabilities: ['marketData'],
      coveragePct: 100,
      minRequiredCoveragePct: 50,
      reasons: [],
    },
    freshnessPolicyVersion: 'v1',
    dataSnapshotVersion: BATCH_DATA_SNAPSHOT_VERSION,
    frozen: true,
  });
}

describe('Phase A frozen identity', () => {
  it('adapterHintFromUniverse does not default unknown universes to NSE', () => {
    expect(adapterHintFromUniverse('CRYPTO_SPOT_ALL')).toBe('CRYPTO_SPOT');
    expect(adapterHintFromUniverse('US_ALL')).toBe('US_EQUITY');
    expect(adapterHintFromUniverse('FOREX_ALL')).toBe('FOREX');
    expect(adapterHintFromUniverse('NIFTY50')).toBe('NSE_EQUITY');
    expect(adapterHintFromUniverse('CUSTOM')).toBeNull();
    expect(adapterHintFromUniverse('SINGLE_STOCK')).toBeNull();
    expect(adapterHintFromUniverse('UNKNOWN_UNIVERSE')).toBeNull();
  });

  it('adapterHintFromInstrumentRef uses frozen venue/class, never NSE for crypto', () => {
    expect(adapterHintFromInstrumentRef(cryptoSpot())).toBe('CRYPTO_SPOT');
    expect(adapterHintFromInstrumentRef(nseEquity())).toBe('NSE_EQUITY');
    expect(
      adapterHintFromInstrumentRef({
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        venue: 'NASDAQ',
        quoteCurrency: 'USD',
      }),
    ).toBe('US_EQUITY');
  });

  it('batchInstrumentToStockQuote preserves BINANCE and uses NSE only for NSE equity', () => {
    const cryptoQuote = batchInstrumentToStockQuote(row(cryptoSpot(), 70000));
    expect(cryptoQuote?.venue).toBe('BINANCE');
    expect(cryptoQuote?.exchange).toBe('BINANCE');
    expect(cryptoQuote?.exchange).not.toBe('NSE');

    const nseQuote = batchInstrumentToStockQuote(row(nseEquity(), 2500));
    expect(nseQuote?.exchange).toBe('NSE');
    expect(nseQuote?.venue).toBe('NSE');
  });

  it('result identity is the frozen InstrumentRef', () => {
    const frozen = row(cryptoSpot());
    const snap = snapshot('CRYPTO_SPOT_ALL', [frozen]);
    const membershipIdentity = instrumentIdentityKey(frozen.instrumentRef);
    expect(instrumentRefFor(snap, membershipIdentity)).toEqual(frozen.instrumentRef);
    const bind = bindFrozenResultIdentity({
      frozen,
      universeId: 'CRYPTO_SPOT_ALL',
      taskSymbol: 'BTCUSDT',
    });
    expect(bind.ok).toBe(true);
    expect(bind.instrument).toEqual(frozen.instrumentRef);
    expect(bind.membershipIdentity).toBe(membershipIdentity);
  });

  it('CRYPTO_SPOT_ALL produces zero NSE:* valid results', () => {
    const snap = snapshot('CRYPTO_SPOT_ALL', [
      row(cryptoSpot('BTCUSDT')),
      row(cryptoSpot('ETHUSDT')),
    ]);
    const valid = snap.instruments.filter(isValidSnapshotRow).map((item) => ({
      symbol: item.instrumentRef.symbol,
      exchange: item.instrumentRef.venue,
      instrument: item.instrumentRef,
      quarantined: item.quarantined,
    }));
    expect(countNseValidResults(valid)).toBe(0);
    expect(snap.identityCounts?.quarantined).toBe(0);
  });

  it('NSE identity in CRYPTO_SPOT_ALL persists IDENTITY_MISMATCH and stays out of validResults', () => {
    const leak = row(nseEquity('BTCUSDT'));
    const snap = snapshot('CRYPTO_SPOT_ALL', [leak, row(cryptoSpot())]);
    expect(snap.instruments[0]?.quarantined).toBe(true);
    expect(snap.instruments[0]?.quarantineStatus).toBe('IDENTITY_MISMATCH');
    const valid = snap.instruments.filter(isValidSnapshotRow);
    expect(valid).toHaveLength(1);
    expect(valid[0]?.instrumentRef.venue).toBe('BINANCE');
    expect(snap.identityCounts).toEqual({ eligible: 2, valid: 1, quarantined: 1 });
    expect(
      countNseValidResults(
        valid.map((item) => ({
          symbol: item.instrumentRef.symbol,
          exchange: item.instrumentRef.venue,
          instrument: item.instrumentRef,
        })),
      ),
    ).toBe(0);
  });

  it('reconstructed ticker identity that disagrees with freeze is quarantined', () => {
    const frozen = row(cryptoSpot());
    const bind = bindFrozenResultIdentity({
      frozen,
      universeId: 'CRYPTO_SPOT_ALL',
      taskSymbol: 'BTCUSDT',
      reconstructed: nseEquity('BTCUSDT'),
    });
    expect(bind.ok).toBe(false);
    expect(bind.quarantined).toBe(true);
    expect(bind.identityStatus).toBe('IDENTITY_MISMATCH');
  });
});

describe('Phase A result recommendation', () => {
  it('emits APPROVE, WAIT, WATCH, NO_TRADE, and REJECT', () => {
    expect(
      deriveBatchResultRecommendation({ tradePlanRecommendation: 'APPROVE' }).recommendation,
    ).toBe('APPROVE');
    expect(
      deriveBatchResultRecommendation({ tradePlanRecommendation: 'WAIT', waitState: 'WAIT' })
        .recommendation,
    ).toBe('WAIT');
    expect(
      deriveBatchResultRecommendation({ tradePlanRecommendation: 'WAIT' }).recommendation,
    ).toBe('WATCH');
    expect(deriveBatchResultRecommendation({ analysisDecision: 'HOLD' }).recommendation).toBe(
      'WATCH',
    );
    expect(deriveBatchResultRecommendation({ analysisDecision: 'NO_TRADE' }).recommendation).toBe(
      'NO_TRADE',
    );
    expect(
      deriveBatchResultRecommendation({ tradePlanRecommendation: 'REJECT' }).recommendation,
    ).toBe('REJECT');
    expect(deriveBatchResultRecommendation({ quarantined: true }).reasonCode).toBe(
      'IDENTITY_MISMATCH',
    );
  });
});
