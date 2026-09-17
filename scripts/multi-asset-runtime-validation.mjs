#!/usr/bin/env node
/**
 * Multi-Asset runtime validation gate (seam CLOSED/FROZEN).
 * Evidence-only: PASS/FAIL. No architectural changes.
 *
 * Checks:
 * 1) NIFTY50 / NIFTY500 universe resolution
 * 2) capabilityCoverage reconciliation vs processed rows
 * 3) US / Crypto / Futures UNAVAILABLE without real inputs
 * 4) simulated never production AVAILABLE / never execution-authorizing
 * 5) Best Pick ranking independence vs Bull-Run availability
 * 6) Optional live gateway batches when services are up
 */
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(ROOT, 'packages/shared-utils/package.json'));

/** Prefer workspace source via dist after build. */
const utils = require('@stockpred/shared-utils');

const {
  resolveIntelligenceUniverse,
  intelligenceUniverseSizes,
  buildBatchResearchReport,
  buildBatchCapabilityCoverage,
  resolveAssetAdapter,
  DISCOVERED_PROVIDERS,
  isProductionMarketDataProvider,
  providerMayEstablishProductionCapability,
  providerAuthorizesExecution,
  providerSupports,
  assertNotLlmDataProvider,
  ZERO_HALLUCINATION_POLICY,
  selectProviderForCapability,
  providerMayRedefineUniverseMembership,
  buildNseMarketSessionState,
  sanitizeSessionLiveConsistency,
  computeCurrentSessionReturn1d,
  assertContinuousNotFullUniverseScan,
} = utils;

let database = null;
try {
  database = require('@stockpred/database');
} catch {
  database = null;
}

const results = [];

function record(id, pass, detail) {
  results.push({ id, pass: !!pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id}${detail ? ` — ${detail}` : ''}`);
}

function loadEnv() {
  const p = resolve(ROOT, '.env');
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

function row(symbol, rank, opts = {}) {
  const withBull = !!opts.withBull;
  const withMl = opts.withMl != null ? !!opts.withMl : withBull;
  return {
    rank,
    symbol,
    opportunityId: `opp-${symbol}-${rank}`,
    sector: opts.sector ?? 'IT',
    intelligenceContext: {
      tradePlanRecommendation: 'WAIT',
      tradePlanStatus: 'PARTIAL',
      tradePlanExecutionReady: false,
      ...(withBull
        ? {
            bullRunStage: 'EARLY',
            bullRunV2Cells: [{ t: 0.2, h: '3M', p: 0.55, conf: 'MEDIUM' }],
          }
        : {}),
      ...(withMl ? { mlDirection: 'UP', mlModelVersion: 'm1' } : {}),
      ...(opts.rs ? { rsBucket: 'STRONG' } : {}),
      ...(opts.quoteGap ? { quoteStatus: 'MDS_UNAVAILABLE' } : {}),
    },
  };
}

function reconcileCoverage(rankings, universe, label) {
  const coverage = buildBatchCapabilityCoverage(rankings, universe);
  const report = buildBatchResearchReport({
    batchId: `val-${label}`,
    completedAt: Date.now(),
    universe,
    coverage: { total: rankings.length, processed: rankings.length, failed: 0 },
    rankings,
  });
  const fromReport = report.capabilityCoverage ?? [];
  let ok = true;
  const notes = [];
  if (fromReport.length !== coverage.length) {
    ok = false;
    notes.push(`length mismatch report=${fromReport.length} direct=${coverage.length}`);
  }
  for (const c of coverage) {
    const na = c.notApplicable ?? 0;
    const sum = c.available + c.partial + c.unavailable;
    // Disposition over processed rows; NOT_APPLICABLE is coverage-only.
    if (na === 0 && sum !== rankings.length) {
      ok = false;
      notes.push(`${c.capability} sum ${sum} != processed ${rankings.length}`);
    }
    if (c.totalCount !== rankings.length && c.totalEligible == null) {
      ok = false;
      notes.push(`${c.capability} totalCount ${c.totalCount} != ${rankings.length}`);
    }
    if (c.totalEligible != null && c.totalCount !== c.totalEligible) {
      ok = false;
      notes.push(`${c.capability} totalCount≠totalEligible`);
    }
    const r = fromReport.find((x) => x.capability === c.capability);
    if (!r || r.available !== c.available || r.partial !== c.partial || r.unavailable !== c.unavailable) {
      ok = false;
      notes.push(`${c.capability} report≠recompute`);
    }
  }
  // Must not be uniform fake completeness across all caps
  const avails = coverage.map((c) => c.available);
  const allSame = avails.every((a) => a === avails[0]);
  const ml = coverage.find((c) => c.capability === 'ml');
  const bull = coverage.find((c) => c.capability === 'bullRun');
  if (rankings.some((r) => r.intelligenceContext?.mlModelVersion) && ml && bull) {
    // with mixed rows, ML/bull available should differ from total when some lack evidence
    if (rankings.length >= 3 && ml.available === rankings.length && !rankings.every((r) => r.intelligenceContext?.mlModelVersion)) {
      ok = false;
      notes.push('ml available falsely complete');
    }
  }
  if (allSame && rankings.length > 2 && coverage.some((c) => c.partial > 0 || c.unavailable > 0)) {
    // uniform available counts across every capability is suspicious when mix exists
    const hasMix = coverage.some((c) => c.available !== c.totalCount);
    if (!hasMix && rankings.some((r) => !r.intelligenceContext?.bullRunStage)) {
      notes.push('warn: uniform coverage');
    }
  }
  return { ok, notes, coverage, ml, bull };
}

async function probeLive(env) {
  const GATEWAY = `http://localhost:${env.API_GATEWAY_PORT || 3000}`;
  const out = { live: false, checks: [] };

  async function j(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 300);
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(t);
    }
  }

  try {
    const health = await j(`${GATEWAY}/health`, { timeoutMs: 8_000 });
    if (health.status !== 200) {
      out.checks.push({ id: 'live.gateway.health', pass: false, detail: `status=${health.status}` });
      return out;
    }
  } catch (e) {
    out.checks.push({
      id: 'live.services',
      pass: false,
      detail: `api-gateway unreachable: ${e instanceof Error ? e.message : String(e)}`,
    });
    return out;
  }

  out.live = true;
  out.checks.push({ id: 'live.gateway.health', pass: true, detail: 'gateway /health 200' });

  const login = await j(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@stockpred.local', password: 'User@12345' }),
    timeoutMs: 30_000,
  });
  if (login.status !== 200 && login.status !== 201) {
    out.checks.push({ id: 'live.login', pass: false, detail: `status=${login.status}` });
    return out;
  }
  const token = login.body?.tokens?.accessToken;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-user-id': login.body?.user?.id,
    'x-brand-id': login.body?.user?.brandId,
  };

  const registry = await j(`${GATEWAY}/api/agent/multi-asset/registry`, {
    headers,
    timeoutMs: 30_000,
  });
  const regOk =
    registry.status === 200 &&
    Array.isArray(registry.body?.nonProductionProviders) &&
    registry.body.nonProductionProviders.includes('simulated') &&
    registry.body.providerAuthorizesExecution === false;
  out.checks.push({
    id: 'live.registry.simulated',
    pass: regOk,
    detail: regOk
      ? 'nonProductionProviders includes simulated; providerAuthorizesExecution=false'
      : JSON.stringify(registry.body)?.slice(0, 200),
  });

  const session = await j(`${GATEWAY}/api/market/session-state`, { headers, timeoutMs: 15_000 });
  const nseOk =
    session.status === 200 &&
    session.body?.nse?.venue === 'NSE' &&
    typeof session.body?.nse?.status === 'string' &&
    Array.isArray(session.body?.sessions);
  out.checks.push({
    id: 'live.marketSession',
    pass: nseOk,
    detail: nseOk
      ? `NSE=${session.body.nse.status} isLive=${session.body.nse.isLive} cards=${session.body.sessions.length}`
      : `status=${session.status}`,
  });
  if (nseOk && session.body.nse.status !== 'OPEN') {
    out.checks.push({
      id: 'live.marketSession.closedNotLive',
      pass: session.body.nse.isLive !== true && session.body.nse.dataStatus !== 'LIVE',
      detail: `status=${session.body.nse.status} dataStatus=${session.body.nse.dataStatus}`,
    });
  }
  // Gated US create — expect reject or empty/unavailable path
  const usCreate = await j(`${GATEWAY}/api/agent/intelligence-batches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ universe: 'US_CUSTOM', symbols: ['AAPL'], scanKind: 'US_SCAN' }),
    timeoutMs: 60_000,
  });
  // Creating may succeed as batch job but adapter caps remain UNAVAILABLE — check resolve
  const usResolve = await j(`${GATEWAY}/api/agent/multi-asset/resolve?symbol=AAPL&hint=US_EQUITY`, {
    headers,
    timeoutMs: 15_000,
  });
  const usCaps = usResolve.body?.capabilities ?? {};
  const usGated =
    usResolve.status === 200 &&
    usCaps.bullRun === 'UNAVAILABLE' &&
    usCaps.historicalCandles === 'UNAVAILABLE';
  out.checks.push({
    id: 'live.us.gated',
    pass: usGated,
    detail: `bullRun=${usCaps.bullRun} historical=${usCaps.historicalCandles} batchCreate=${usCreate.status}`,
  });

  const cryptoResolve = await j(
    `${GATEWAY}/api/agent/multi-asset/resolve?symbol=BTCUSDT&hint=CRYPTO_SPOT`,
    { headers, timeoutMs: 15_000 },
  );
  const cCaps = cryptoResolve.body?.capabilities ?? {};
  out.checks.push({
    id: 'live.crypto.gated',
    pass: cryptoResolve.status === 200 && cCaps.bullRun === 'UNAVAILABLE',
    detail: `bullRun=${cCaps.bullRun}`,
  });

  const futResolve = await j(
    `${GATEWAY}/api/agent/multi-asset/resolve?symbol=ES&hint=INDEX_FUTURE`,
    { headers, timeoutMs: 15_000 },
  );
  const fCaps = futResolve.body?.capabilities ?? {};
  out.checks.push({
    id: 'live.futures.gated',
    pass: futResolve.status === 200 && fCaps.bullRun === 'UNAVAILABLE',
    detail: `bullRun=${fCaps.bullRun}`,
  });

  // Start NIFTY50 batch and wait for research report
  const create50 = await j(`${GATEWAY}/api/agent/intelligence-batches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ universe: 'NIFTY50', scanKind: 'FULL_MARKET' }),
    timeoutMs: 60_000,
  });
  if (create50.status !== 200 && create50.status !== 201) {
    out.checks.push({
      id: 'live.nifty50.create',
      pass: false,
      detail: `status=${create50.status} ${JSON.stringify(create50.body)?.slice(0, 180)}`,
    });
    return out;
  }
  const batchId = create50.body?.batchId;
  out.checks.push({ id: 'live.nifty50.create', pass: !!batchId, detail: `batchId=${batchId}` });

  let completed = null;
  const deadline = Date.now() + 25 * 60_000;
  while (Date.now() < deadline) {
    const det = await j(`${GATEWAY}/api/agent/intelligence-batches/${encodeURIComponent(batchId)}`, {
      headers,
      timeoutMs: 30_000,
    });
    const st = det.body?.status;
    if (st === 'COMPLETED' || st === 'PARTIAL' || st === 'FAILED' || st === 'CANCELLED') {
      completed = det.body;
      break;
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  if (!completed) {
    out.checks.push({ id: 'live.nifty50.complete', pass: false, detail: 'timeout waiting for batch' });
    return out;
  }
  out.checks.push({
    id: 'live.nifty50.complete',
    pass: completed.status === 'COMPLETED' || completed.status === 'PARTIAL',
    detail: `status=${completed.status}`,
  });

  const reportRes = await j(
    `${GATEWAY}/api/agent/intelligence-batches/${encodeURIComponent(batchId)}/research-report`,
    { headers, timeoutMs: 60_000 },
  );
  const report = reportRes.body?.report ?? reportRes.body;
  const resultsPage = await j(
    `${GATEWAY}/api/agent/intelligence-batches/${encodeURIComponent(batchId)}/results?page=1&pageSize=500`,
    { headers, timeoutMs: 60_000 },
  );
  const liveRankings = resultsPage.body?.rankings ?? [];
  const reportTotal =
    report?.dashboardSummary?.total ??
    report?.coverage?.processed ??
    liveRankings.length;
  const coverage = Array.isArray(report?.capabilityCoverage) ? report.capabilityCoverage : [];
  if (!coverage.length || !(reportTotal > 0)) {
    out.checks.push({
      id: 'live.nifty50.capabilityCoverage',
      pass: false,
      detail: `coverage=${coverage.length} reportTotal=${reportTotal} pageRankings=${liveRankings.length}`,
    });
  } else {
    let match = true;
    const mismatches = [];
    for (const e of coverage) {
      const na = e.notApplicable ?? 0;
      const sum = e.available + e.partial + e.unavailable;
      const denom = e.totalEligible ?? e.totalCount;
      if (na === 0 && e.processedCount != null && sum !== e.processedCount && sum !== reportTotal) {
        // completed batches: processed ≈ reportTotal
        if (sum !== reportTotal && denom === reportTotal) {
          match = false;
          mismatches.push(`${e.capability}:${sum}/${denom} vs ${reportTotal}`);
        }
      } else if (na === 0 && denom === reportTotal && sum !== reportTotal) {
        match = false;
        mismatches.push(`${e.capability}:${sum}/${e.totalCount} vs ${reportTotal}`);
      }
    }
    // When a full page of rankings is available, also recompute for that page subset only if page==total
    if (match && liveRankings.length === reportTotal) {
      const expected = buildBatchCapabilityCoverage(liveRankings, 'NIFTY50');
      for (const e of expected) {
        const a = coverage.find((x) => x.capability === e.capability);
        if (!a || a.available !== e.available || a.partial !== e.partial || a.unavailable !== e.unavailable) {
          match = false;
          mismatches.push(`recompute:${e.capability}`);
        }
      }
    }
    out.checks.push({
      id: 'live.nifty50.capabilityCoverage',
      pass: match,
      detail: match
        ? `reconciled reportTotal=${reportTotal} caps=${coverage.length} pageRankings=${liveRankings.length}`
        : `mismatches=${mismatches.join(',')}`,
    });
  }

  // Best picks from report — independence checked offline; live: ensure bestPicks ⊆ ranking order
  const best = report?.bestPicks ?? [];
  const opps = report?.bestOpportunities ?? [];
  let orderOk = true;
  for (let i = 1; i < opps.length; i++) {
    if ((opps[i].rank ?? 0) < (opps[i - 1].rank ?? 0)) orderOk = false;
  }
  out.checks.push({
    id: 'live.nifty50.rankingOrder',
    pass: orderOk,
    detail: `opportunities=${opps.length} bestPicks=${best.length}`,
  });

  // NIFTY500 — start only; full wait may exceed gate window — create + short poll
  const create500 = await j(`${GATEWAY}/api/agent/intelligence-batches`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ universe: 'NIFTY500', scanKind: 'FULL_MARKET' }),
    timeoutMs: 60_000,
  });
  out.checks.push({
    id: 'live.nifty500.create',
    pass: create500.status === 200 || create500.status === 201,
    detail: `status=${create500.status} batchId=${create500.body?.batchId ?? 'n/a'}`,
  });

  return out;
}

async function main() {
  console.log('=== Multi-Asset Runtime Validation Gate ===');
  console.log('Seam: CLOSED/FROZEN — evidence only\n');

  // 1) Universes
  const sizes = intelligenceUniverseSizes();
  const n50 = resolveIntelligenceUniverse({ universe: 'NIFTY50' });
  const n500 = resolveIntelligenceUniverse({ universe: 'NIFTY500' });
  record(
    'universe.nifty50',
    n50.length === sizes.NIFTY50 && n50.length === 50,
    `resolved=${n50.length} declared=${sizes.NIFTY50}`,
  );
  record(
    'universe.nifty500',
    n500.length === sizes.NIFTY500 && n500.length >= 500,
    `resolved=${n500.length} declared=${sizes.NIFTY500}`,
  );

  // 2) capabilityCoverage reconciliation — NIFTY50-shaped and NIFTY500-shaped processed rows
  const rows50 = n50.map((sym, i) =>
    row(sym, i + 1, { withBull: i < 12, withMl: i < 12, rs: i < 8, quoteGap: i === 49 }),
  );
  const r50 = reconcileCoverage(rows50, 'NIFTY50', 'NIFTY50');
  record(
    'capabilityCoverage.nifty50.reconcile',
    r50.ok,
    r50.ok
      ? `rows=50 mlAvail=${r50.ml?.available} bullAvail=${r50.bull?.available}`
      : r50.notes.join('; '),
  );

  const rows500 = n500.map((sym, i) =>
    row(sym, i + 1, { withBull: i < 105, withMl: i < 499, rs: i < 105, quoteGap: i >= 490 && i < 495 }),
  );
  const r500 = reconcileCoverage(rows500, 'NIFTY500', 'NIFTY500');
  record(
    'capabilityCoverage.nifty500.reconcile',
    r500.ok &&
      r500.ml?.available === 499 &&
      r500.bull?.available === 105 &&
      r500.ml?.available !== r500.ml?.totalCount,
    r500.ok
      ? `rows=${rows500.length} ml=${r500.ml?.available}/${r500.ml?.totalCount} bull=${r500.bull?.available}/${r500.bull?.totalCount} rsPartial=${r500.coverage.find((c) => c.capability === 'relationships')?.partial}`
      : r500.notes.join('; '),
  );

  // 3) US / Crypto / Futures gated
  const us = resolveAssetAdapter('AAPL', 'US_EQUITY');
  const crypto = resolveAssetAdapter('BTCUSDT', 'CRYPTO_SPOT');
  const fut = resolveAssetAdapter('ES', 'INDEX_FUTURE');
  record(
    'gated.us',
    us.capabilities().bullRun === 'UNAVAILABLE' &&
      us.capabilities().historicalCandles === 'UNAVAILABLE',
    `bullRun=${us.capabilities().bullRun}`,
  );
  record(
    'gated.crypto',
    crypto.capabilities().bullRun === 'UNAVAILABLE' && crypto.isSessionOpen() === true,
    `bullRun=${crypto.capabilities().bullRun} sessionOpen=${crypto.isSessionOpen()}`,
  );
  record(
    'gated.futures',
    fut.capabilities().bullRun === 'UNAVAILABLE' &&
      fut.normalizeSeries([]).seriesProvenance.seriesType === 'INDIVIDUAL_CONTRACT',
    `bullRun=${fut.capabilities().bullRun} provenance=${fut.normalizeSeries([]).seriesProvenance.seriesType}`,
  );

  // 4) simulated isolation
  const sim = DISCOVERED_PROVIDERS.find((p) => p.provider === 'simulated');
  record(
    'simulated.isolation',
    !!sim &&
      sim.liveQuote === 'UNAVAILABLE' &&
      sim.historicalCandles === 'UNAVAILABLE' &&
      !isProductionMarketDataProvider('simulated') &&
      !providerMayEstablishProductionCapability('simulated') &&
      providerAuthorizesExecution('simulated') === false &&
      providerSupports('simulated', 'liveQuote') === 'UNAVAILABLE',
    'production=NO execution=NEVER',
  );

  // 5) Best Pick ranking independence
  const base = [
    row('AAA', 1, { withBull: false, withMl: false }),
    row('BBB', 2, { withBull: false, withMl: false }),
    row('CCC', 3, { withBull: false, withMl: false }),
  ];
  const withBull = [
    row('AAA', 1, { withBull: true }),
    row('BBB', 2, { withBull: true }),
    row('CCC', 3, { withBull: false, withMl: false }),
  ];
  const repBase = buildBatchResearchReport({
    batchId: 'rank-base',
    completedAt: 1,
    universe: 'NIFTY50',
    coverage: { total: 3, processed: 3, failed: 0 },
    rankings: base,
  });
  const repBull = buildBatchResearchReport({
    batchId: 'rank-bull',
    completedAt: 2,
    universe: 'NIFTY50',
    coverage: { total: 3, processed: 3, failed: 0 },
    rankings: withBull,
  });
  const orderBase = repBase.bestOpportunities.map((o) => o.symbol).join(',');
  const orderBull = repBull.bestOpportunities.map((o) => o.symbol).join(',');
  record(
    'ranking.independence',
    orderBase === orderBull && orderBase === 'AAA,BBB,CCC',
    `withoutBull=${orderBase} withBull=${orderBull}`,
  );

  // 6) Zero-hallucination + source authority
  record(
    'zeroHallucination.llmNotDataSource',
    ZERO_HALLUCINATION_POLICY.llmIsAuthoritativeDataSource === false &&
      assertNotLlmDataProvider('openai') === false &&
      assertNotLlmDataProvider('yahoo') === true,
    'LLM forbidden as data provider',
  );
  const provSel = selectProviderForCapability({ capability: 'marketData' });
  record(
    'sourceAuthority.noSimulatedAutoFailover',
    !!provSel && provSel.provider !== 'simulated' && providerMayRedefineUniverseMembership('yahoo') === false,
    `provider=${provSel?.provider}`,
  );
  record(
    'continuous.forbidFullUniverse',
    assertContinuousNotFullUniverseScan({ mode: 'TARGETED_REFRESH', symbolCount: 500 }).ok === false &&
      assertContinuousNotFullUniverseScan({ mode: 'TARGETED_REFRESH', symbolCount: 5 }).ok === true,
    'targeted only',
  );

  // 7) NSE_ALL canonical completeness (equity-master — not MDS)
  if (database?.publishNseAllFromEquityMaster && database?.assertMembershipNotFromMdsCache) {
    const pub = database.publishNseAllFromEquityMaster();
    const snap = pub.snapshot;
    const eligible = snap?.eligibleRecordCount ?? 0;
    const membership = (snap?.instruments ?? []).map((i) => i.symbol);
    const fakeMds = membership.slice(0, Math.min(146, membership.length));
    const indep = database.assertMembershipNotFromMdsCache(membership, fakeMds);
    record(
      'nseAll.canonicalCompleteness',
      !!pub.published &&
        eligible > 0 &&
        eligible !== 146 &&
        pub.validation?.sourceCount >= eligible &&
        indep.ok === true,
      `eligible=${eligible} sourceCount=${pub.validation?.sourceCount} version=${snap?.version} indep=${indep.detail}`,
    );
    const drop = database.evaluateCompletenessGuard({ previousEligible: 2100, nextEligible: 146 });
    record(
      'nseAll.lastKnownGoodGuard',
      drop.ok === false,
      `status=${drop.completenessStatus}`,
    );
    for (const id of ['US_SP500', 'US_ALL', 'CRYPTO_ALL', 'COMMODITY_ALL', 'FUTURES_ALL']) {
      const g = database.resolveGatedCanonicalUniverse(id);
      record(
        `gated.universe.${id}`,
        g.supported === false && g.reasonCode === 'UNSUPPORTED_UNIVERSE',
        g.detail ?? g.reasonCode,
      );
    }
  } else {
    record(
      'nseAll.canonicalCompleteness',
      false,
      '@stockpred/database not built — run npm run build -w @stockpred/database',
    );
  }

  // 8) Market session + session-1D
  const closedLive = sanitizeSessionLiveConsistency({
    ...buildNseMarketSessionState({ now: Date.now(), lastMarketUpdateAt: Date.now() }),
    status: 'CLOSED',
    isLive: true,
    dataStatus: 'LIVE',
  });
  record(
    'marketSession.closedNotLive',
    closedLive.isLive === false && closedLive.dataStatus !== 'LIVE',
    `status=${closedLive.status} dataStatus=${closedLive.dataStatus}`,
  );
  const TUE_LIVE = Date.UTC(2026, 8, 15, 5, 30, 0);
  const FRI_CLOSE = Date.UTC(2026, 8, 11, 10, 0, 0);
  const THU_CLOSE = Date.UTC(2026, 8, 10, 10, 0, 0);
  const s1d = computeCurrentSessionReturn1d({
    candles: [
      { close: 98, time: THU_CLOSE },
      { close: 100, time: FRI_CLOSE },
    ],
    lastPrice: 103,
    previousClose: 100,
    quoteUpdatedAt: TUE_LIVE - 5_000,
    now: TUE_LIVE,
  });
  record(
    'session1d.plus3pct',
    s1d.source === 'LIVE_LTP' && Math.abs((s1d.return1d ?? 0) - 0.03) < 1e-4,
    `return1d=${s1d.return1d} source=${s1d.source}`,
  );

  // 9) Live probe (optional)
  const env = loadEnv();
  console.log('\n--- Live service probe ---');
  const live = await probeLive(env);
  for (const c of live.checks) {
    record(c.id, c.pass, c.detail);
  }
  if (!live.live) {
    record(
      'live.stack',
      false,
      'Services down — offline harness PASS/FAIL above still applies; restart stack to complete live NIFTY50/500',
    );
  }

  const failed = results.filter((r) => !r.pass);
  const offlineIds = results.filter((r) => !r.id.startsWith('live.'));
  const offlineFailed = offlineIds.filter((r) => !r.pass);

  console.log('\n=== SUMMARY ===');
  console.log(
    JSON.stringify(
      {
        offline: {
          total: offlineIds.length,
          passed: offlineIds.length - offlineFailed.length,
          failed: offlineFailed.map((f) => f.id),
          verdict: offlineFailed.length === 0 ? 'PASS' : 'FAIL',
        },
        live: {
          reachable: live.live,
          checks: live.checks.length,
          failed: results.filter((r) => r.id.startsWith('live.') && !r.pass).map((f) => f.id),
          verdict: !live.live
            ? 'BLOCKED'
            : results.some((r) => r.id.startsWith('live.') && !r.pass)
              ? 'FAIL'
              : 'PASS',
        },
        overall:
          offlineFailed.length === 0 && live.live && !results.some((r) => r.id.startsWith('live.') && !r.pass)
            ? 'PASS'
            : offlineFailed.length === 0 && !live.live
              ? 'PASS_OFFLINE_LIVE_BLOCKED'
              : 'FAIL',
        seam: 'CLOSED/FROZEN',
      },
      null,
      2,
    ),
  );

  process.exit(offlineFailed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
