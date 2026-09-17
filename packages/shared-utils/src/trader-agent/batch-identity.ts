/**
 * Frozen InstrumentRef is the sole source of batch result identity.
 * Ticker re-resolution and NSE defaults are identity failures.
 */

import type {
  AssetClass,
  BatchDataSnapshot,
  BatchIdentityCounts,
  BatchInstrumentData,
  BatchResultRecommendation,
  InstrumentRef,
  IntelligenceBatchResultRow,
} from '@stockpred/shared-types';
import {
  adapterHintFromInstrumentRef,
  adapterHintFromUniverse,
  instrumentIdentityKey,
  resolveAdapterFromInstrumentRef,
} from './instrument-registry';

export const IDENTITY_MISMATCH = 'IDENTITY_MISMATCH' as const;

export interface FrozenIdentityBind {
  ok: boolean;
  quarantined: boolean;
  quarantineStatus?: typeof IDENTITY_MISMATCH;
  identityStatus: 'VALID' | typeof IDENTITY_MISMATCH;
  instrument?: InstrumentRef;
  membershipIdentity?: string;
  reasonCode?: typeof IDENTITY_MISMATCH;
  reason?: string;
}

const CRYPTO_SPOT_UNIVERSES = new Set(['CRYPTO_SPOT_ALL', 'CRYPTO_ALL', 'CRYPTO_CUSTOM']);
const CRYPTO_FUTURE_UNIVERSES = new Set(['CRYPTO_FUTURES_ALL']);
const US_UNIVERSES = new Set(['US_ALL', 'US_SP500', 'US_CUSTOM']);
const NSE_UNIVERSES = new Set([
  'NIFTY50',
  'NIFTY100',
  'NIFTY150',
  'NIFTY500',
  'ALL',
  'NSE_ALL',
  'SECTOR',
]);

export function cloneInstrumentRef(ref: InstrumentRef): InstrumentRef {
  return { ...ref };
}

export function sameInstrumentRef(
  a: InstrumentRef | undefined,
  b: InstrumentRef | undefined,
): boolean {
  if (!a || !b) return false;
  return instrumentIdentityKey(a) === instrumentIdentityKey(b) && a.symbol === b.symbol;
}

export function expectedAssetClassFromUniverse(universeId: string): AssetClass | null {
  const u = String(universeId ?? '')
    .trim()
    .toUpperCase();
  if (CRYPTO_FUTURE_UNIVERSES.has(u)) return 'CRYPTO_FUTURE';
  if (CRYPTO_SPOT_UNIVERSES.has(u) || u.startsWith('CRYPTO_')) return 'CRYPTO_SPOT';
  if (u === 'COMMODITY_ALL' || u === 'COMMODITIES_CUSTOM') return 'COMMODITY';
  if (u === 'FOREX_ALL' || u.startsWith('FOREX_')) return 'FX';
  if (u === 'MCX_FUTURES_ALL' || u === 'CME_FUTURES_ALL') return 'COMMODITY_FUTURE';
  if (u === 'FUTURES_ALL' || u.startsWith('FUTURES_')) return 'INDEX_FUTURE';
  if (US_UNIVERSES.has(u) || u.startsWith('US_')) return 'EQUITY';
  if (NSE_UNIVERSES.has(u) || u.startsWith('NIFTY')) return 'EQUITY';
  return null;
}

export function instrumentRefFor(
  snapshot: BatchDataSnapshot,
  membershipIdentity: string,
): InstrumentRef | undefined {
  const key = String(membershipIdentity ?? '').trim();
  if (!key) return undefined;
  return snapshot.instruments.find((row) => instrumentIdentityKey(row.instrumentRef) === key)
    ?.instrumentRef;
}

export function frozenInstrumentForSymbol(
  snapshot: BatchDataSnapshot | null | undefined,
  symbol: string,
): BatchInstrumentData | undefined {
  if (!snapshot) return undefined;
  const needle = String(symbol ?? '')
    .trim()
    .toUpperCase();
  return snapshot.instruments.find(
    (row) => String(row.instrumentRef.symbol ?? '').toUpperCase() === needle,
  );
}

function nseVenueLeak(ref: InstrumentRef, universeId: string): boolean {
  const u = String(universeId ?? '')
    .trim()
    .toUpperCase();
  const venue = String(ref.venue ?? '').toUpperCase();
  if (venue !== 'NSE' && venue !== 'BSE') return false;
  if (CRYPTO_SPOT_UNIVERSES.has(u) || CRYPTO_FUTURE_UNIVERSES.has(u) || u.startsWith('CRYPTO_')) {
    return true;
  }
  if (US_UNIVERSES.has(u) || u.startsWith('US_')) return true;
  if (u === 'FOREX_ALL' || u.startsWith('FOREX_')) return true;
  if (u.startsWith('COMMODIT') || u === 'MCX_FUTURES_ALL' || u === 'CME_FUTURES_ALL') return true;
  return false;
}

export function validateInstrumentAgainstUniverse(
  ref: InstrumentRef | undefined,
  universeId: string,
): FrozenIdentityBind {
  if (!ref) {
    return {
      ok: false,
      quarantined: true,
      quarantineStatus: IDENTITY_MISMATCH,
      identityStatus: IDENTITY_MISMATCH,
      reasonCode: IDENTITY_MISMATCH,
      reason: 'Frozen InstrumentRef missing for task',
    };
  }
  const expected = expectedAssetClassFromUniverse(universeId);
  if (expected && ref.assetClass !== expected) {
    return {
      ok: false,
      quarantined: true,
      quarantineStatus: IDENTITY_MISMATCH,
      identityStatus: IDENTITY_MISMATCH,
      instrument: cloneInstrumentRef(ref),
      membershipIdentity: instrumentIdentityKey(ref),
      reasonCode: IDENTITY_MISMATCH,
      reason: `Frozen assetClass ${ref.assetClass} does not match universe ${universeId}`,
    };
  }
  if (nseVenueLeak(ref, universeId)) {
    return {
      ok: false,
      quarantined: true,
      quarantineStatus: IDENTITY_MISMATCH,
      identityStatus: IDENTITY_MISMATCH,
      instrument: cloneInstrumentRef(ref),
      membershipIdentity: instrumentIdentityKey(ref),
      reasonCode: IDENTITY_MISMATCH,
      reason: `Frozen venue ${ref.venue} is not valid for universe ${universeId}`,
    };
  }
  const hint = adapterHintFromInstrumentRef(ref) ?? adapterHintFromUniverse(universeId);
  if (!hint && expected) {
    return {
      ok: false,
      quarantined: true,
      quarantineStatus: IDENTITY_MISMATCH,
      identityStatus: IDENTITY_MISMATCH,
      instrument: cloneInstrumentRef(ref),
      membershipIdentity: instrumentIdentityKey(ref),
      reasonCode: IDENTITY_MISMATCH,
      reason: 'No adapter mapping for frozen InstrumentRef',
    };
  }
  return {
    ok: true,
    quarantined: false,
    identityStatus: 'VALID',
    instrument: cloneInstrumentRef(ref),
    membershipIdentity: instrumentIdentityKey(ref),
  };
}

export function bindFrozenResultIdentity(input: {
  frozen?: BatchInstrumentData;
  universeId: string;
  taskSymbol: string;
  reconstructed?: InstrumentRef | null;
}): FrozenIdentityBind {
  const frozenRef = input.frozen?.instrumentRef;
  const vsUniverse = validateInstrumentAgainstUniverse(frozenRef, input.universeId);
  if (!vsUniverse.ok || !frozenRef) return vsUniverse;

  const membershipIdentity = instrumentIdentityKey(frozenRef);
  if (input.reconstructed && !sameInstrumentRef(frozenRef, input.reconstructed)) {
    return {
      ok: false,
      quarantined: true,
      quarantineStatus: IDENTITY_MISMATCH,
      identityStatus: IDENTITY_MISMATCH,
      instrument: cloneInstrumentRef(frozenRef),
      membershipIdentity,
      reasonCode: IDENTITY_MISMATCH,
      reason: 'Reconstructed identity does not match frozen InstrumentRef',
    };
  }

  const taskSymbol = String(input.taskSymbol ?? '')
    .trim()
    .toUpperCase();
  const frozenSymbol = String(frozenRef.symbol ?? '')
    .trim()
    .toUpperCase();
  if (taskSymbol && frozenSymbol && taskSymbol !== frozenSymbol) {
    return {
      ok: false,
      quarantined: true,
      quarantineStatus: IDENTITY_MISMATCH,
      identityStatus: IDENTITY_MISMATCH,
      instrument: cloneInstrumentRef(frozenRef),
      membershipIdentity,
      reasonCode: IDENTITY_MISMATCH,
      reason: `Task symbol ${taskSymbol} does not match frozen ${frozenSymbol}`,
    };
  }

  return {
    ok: true,
    quarantined: false,
    identityStatus: 'VALID',
    instrument: cloneInstrumentRef(frozenRef),
    membershipIdentity,
  };
}

export function annotateSnapshotIdentities(snapshot: BatchDataSnapshot): BatchDataSnapshot {
  let quarantined = 0;
  const instruments = snapshot.instruments.map((row) => {
    const bind = validateInstrumentAgainstUniverse(row.instrumentRef, snapshot.universeId);
    if (!bind.ok) {
      quarantined += 1;
      return {
        ...row,
        quarantined: true,
        quarantineStatus: IDENTITY_MISMATCH,
        reasonCode: row.reasonCode ?? IDENTITY_MISMATCH,
        message: bind.reason ?? row.message,
      };
    }
    return { ...row, quarantined: false };
  });
  const eligible = snapshot.coverage?.eligible ?? instruments.length;
  const identityCounts: BatchIdentityCounts = {
    eligible,
    valid: Math.max(0, instruments.length - quarantined),
    quarantined,
  };
  return { ...snapshot, instruments, identityCounts };
}

export function isValidSnapshotRow(row: BatchInstrumentData | undefined): boolean {
  return !!row && row.quarantineStatus !== IDENTITY_MISMATCH && row.quarantined !== true;
}

export function deriveBatchResultRecommendation(input: {
  quarantined?: boolean;
  tradePlanRecommendation?: string | null;
  analysisDecision?: string | null;
  waitState?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
}): {
  recommendation: BatchResultRecommendation;
  reasonCode: string;
  reason: string;
} {
  if (input.quarantined) {
    return {
      recommendation: 'NO_TRADE',
      reasonCode: IDENTITY_MISMATCH,
      reason: input.reason?.trim() || 'Quarantined: frozen InstrumentRef mismatch',
    };
  }
  const plan = String(input.tradePlanRecommendation ?? '')
    .trim()
    .toUpperCase();
  const decision = String(input.analysisDecision ?? '')
    .trim()
    .toUpperCase();
  const waitState = String(input.waitState ?? '')
    .trim()
    .toUpperCase();
  const reasonCode = input.reasonCode?.trim() || undefined;
  const reason = input.reason?.trim() || undefined;

  if (plan === 'APPROVE') {
    return {
      recommendation: 'APPROVE',
      reasonCode: reasonCode ?? 'TRADE_PLAN_APPROVE',
      reason: reason ?? 'ProfessionalTrader approved the setup',
    };
  }
  if (plan === 'REJECT') {
    return {
      recommendation: 'REJECT',
      reasonCode: reasonCode ?? 'TRADE_PLAN_REJECT',
      reason: reason ?? 'ProfessionalTrader rejected the setup',
    };
  }
  if (decision === 'NO_TRADE') {
    return {
      recommendation: 'NO_TRADE',
      reasonCode: reasonCode ?? 'ANALYSIS_NO_TRADE',
      reason: reason ?? 'Analysis decision is NO_TRADE',
    };
  }
  if (plan === 'WAIT' && waitState === 'WAIT') {
    return {
      recommendation: 'WAIT',
      reasonCode: reasonCode ?? 'TRADE_PLAN_WAIT',
      reason: reason ?? 'Wait for a confirmed trigger',
    };
  }
  if (plan === 'WAIT' || decision === 'HOLD' || decision === 'WATCH') {
    return {
      recommendation: 'WATCH',
      reasonCode: reasonCode ?? 'WATCH_SETUP',
      reason: reason ?? 'Watch the setup; not yet a wait trigger or approval',
    };
  }
  if (decision === 'WAIT') {
    return {
      recommendation: 'WAIT',
      reasonCode: reasonCode ?? 'ANALYSIS_WAIT',
      reason: reason ?? 'Analysis decision is WAIT',
    };
  }
  return {
    recommendation: 'WAIT',
    reasonCode: reasonCode ?? 'INSUFFICIENT_SETUP',
    reason: reason ?? 'No ProfessionalTrader approval',
  };
}

export function quarantinedResultRow(input: {
  symbol: string;
  frozen?: BatchInstrumentData;
  bind: FrozenIdentityBind;
  rank?: number;
}): IntelligenceBatchResultRow {
  const instrument = input.bind.instrument ?? input.frozen?.instrumentRef;
  const rec = deriveBatchResultRecommendation({
    quarantined: true,
    reason: input.bind.reason,
  });
  const adapter = instrument ? resolveAdapterFromInstrumentRef(instrument) : null;
  return {
    rank: input.rank ?? 0,
    symbol: input.symbol,
    opportunityId: `quarantine-${input.symbol}`,
    exchange: instrument?.venue,
    identityStatus: IDENTITY_MISMATCH,
    instrument: instrument ? cloneInstrumentRef(instrument) : undefined,
    adapterId: adapter?.id,
    membershipIdentity: input.bind.membershipIdentity,
    quarantined: true,
    quarantineStatus: IDENTITY_MISMATCH,
    recommendation: rec.recommendation,
    reasonCode: rec.reasonCode,
    reason: rec.reason,
  };
}

export function nseIdentityKey(row: {
  exchange?: string;
  instrument?: InstrumentRef;
  symbol: string;
}): string {
  const venue = String(row.instrument?.venue ?? row.exchange ?? '')
    .trim()
    .toUpperCase();
  return `${venue}:${String(row.symbol ?? '').toUpperCase()}`;
}

export function countNseValidResults(
  rows: Array<{
    symbol: string;
    exchange?: string;
    instrument?: InstrumentRef;
    quarantined?: boolean;
    quarantineStatus?: string;
  }>,
): number {
  return rows.filter((row) => {
    if (row.quarantined || row.quarantineStatus === IDENTITY_MISMATCH) return false;
    const venue = String(row.instrument?.venue ?? row.exchange ?? '')
      .trim()
      .toUpperCase();
    return venue === 'NSE';
  }).length;
}
