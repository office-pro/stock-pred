import axios from 'axios';
import { withRetry } from '@stockpred/shared-utils';
import { yahooTickerCandidates, type YahooSymbolHint } from './yahoo.provider';

/** Yahoo rate-limits bursts; keep the same politeness gap as chart fetches. */
const REQUEST_GAP_MS = 350;
const SESSION_TTL_MS = 45 * 60_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

interface YahooSession {
  crumb: string;
  cookie: string;
}

function appendSetCookie(existing: string, setCookie?: string | string[]): string {
  const list = !setCookie ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
  const map = new Map<string, string>();
  for (const pair of existing
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const raw of list) {
    const first = String(raw).split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq > 0) map.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function parseCrumb(raw: unknown): string {
  return String(raw ?? '')
    .replace(/^"+|"+$/g, '')
    .trim();
}

function isValidCrumb(crumb: string): boolean {
  return crumb.length > 0 && crumb.length < 80 && !crumb.includes('<') && !/\s/.test(crumb);
}

/** Conservative filing lag when Yahoo has no publication date (calendar days). */
export const FUNDAMENTAL_LAG_DAYS = 90;
const DAY_MS = 86_400_000;
const YOY_MATCH_DAYS = 40;

const QUOTE_MODULES = [
  'assetProfile',
  'defaultKeyStatistics',
  'financialData',
  'summaryDetail',
  'incomeStatementHistoryQuarterly',
  'balanceSheetHistoryQuarterly',
  'cashflowStatementHistoryQuarterly',
  'incomeStatementHistory',
  'balanceSheetHistory',
  'cashflowStatementHistory',
  'majorHoldersBreakdown',
].join(',');

export interface FundamentalSnapshotInput {
  symbol: string;
  asOfDate: Date;
  availableAt: Date;
  source: string;
  sector: string | null;
  revenue: number | null;
  pat: number | null;
  eps: number | null;
  ebit: number | null;
  ebitda: number | null;
  equity: number | null;
  totalDebt: number | null;
  totalAssets: number | null;
  currentAssets: number | null;
  currentLiab: number | null;
  cash: number | null;
  ocf: number | null;
  capex: number | null;
  fcf: number | null;
  revYoy: number | null;
  patYoy: number | null;
  epsYoy: number | null;
  opMargin: number | null;
  netMargin: number | null;
  grossMargin: number | null;
  ebitdaMargin: number | null;
  roe: number | null;
  roa: number | null;
  roce: number | null;
  debtEquity: number | null;
  currentRatio: number | null;
  cashRatio: number | null;
  ocfPat: number | null;
  fcfGrowth: number | null;
  fcfMargin: number | null;
  trailingEps: number | null;
  bookValue: number | null;
  trailingPe: number | null;
  priceToBook: number | null;
  sectorMedianPe: number | null;
  promoterHolding: number | null;
  institutionHolding: number | null;
  displayScore: number | null;
}

interface PeriodRow {
  endDate: Date;
  revenue: number | null;
  pat: number | null;
  eps: number | null;
  ebit: number | null;
  ebitda: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  equity: number | null;
  totalDebt: number | null;
  totalAssets: number | null;
  currentAssets: number | null;
  currentLiab: number | null;
  cash: number | null;
  ocf: number | null;
  capex: number | null;
  fcf: number | null;
}

function rawNumber(node: unknown): number | null {
  if (node == null) return null;
  if (typeof node === 'number' && Number.isFinite(node)) return node;
  if (typeof node === 'string' && node.trim() !== '') {
    const parsed = Number(node);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof node === 'object' && node !== null && 'raw' in node) {
    return rawNumber((node as { raw?: unknown }).raw);
  }
  return null;
}

function rawDate(node: unknown): Date | null {
  const seconds = rawNumber(node);
  if (seconds == null || seconds <= 0) return null;
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function availableAtFromPeriodEnd(endDate: Date, lagDays = FUNDAMENTAL_LAG_DAYS): Date {
  return new Date(utcMidnight(endDate).getTime() + lagDays * DAY_MS);
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function yoy(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  const value = current / prior - 1;
  return Number.isFinite(value) ? value : null;
}

function sum(values: Array<number | null>): number | null {
  const present = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (present.length === 0) return null;
  return present.reduce((total, value) => total + value, 0);
}

function pick(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

function clip(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function mapRange(
  value: number,
  fromLo: number,
  fromHi: number,
  toLo: number,
  toHi: number,
): number {
  if (fromHi === fromLo) return toLo;
  const t = clip((value - fromLo) / (fromHi - fromLo), 0, 1);
  return toLo + t * (toHi - toLo);
}

function asRecord(node: unknown): Record<string, unknown> {
  return node && typeof node === 'object' ? (node as Record<string, unknown>) : {};
}

function statementList(container: unknown, key: string): Record<string, unknown>[] {
  const root = asRecord(container);
  const direct = root[key];
  if (Array.isArray(direct)) return direct.map(asRecord);
  if (Array.isArray(container)) return (container as unknown[]).map(asRecord);
  const inner = asRecord(direct ?? root);
  const list =
    inner[key] ??
    inner.incomeStatementHistory ??
    inner.balanceSheetStatements ??
    inner.cashflowStatements ??
    inner.cashFlowStatements;
  return Array.isArray(list) ? list.map(asRecord) : [];
}

function parseIncome(row: Record<string, unknown>): Partial<PeriodRow> {
  return {
    endDate: rawDate(row.endDate) ?? undefined,
    revenue: rawNumber(row.totalRevenue),
    pat: rawNumber(row.netIncome),
    eps: rawNumber(row.dilutedEPS ?? row.basicEPS),
    ebit: rawNumber(row.ebit ?? row.operatingIncome),
    ebitda: rawNumber(row.ebitda),
    grossProfit: rawNumber(row.grossProfit),
    operatingIncome: rawNumber(row.operatingIncome ?? row.ebit),
  };
}

function parseBalance(row: Record<string, unknown>): Partial<PeriodRow> {
  const longDebt = rawNumber(row.longTermDebt);
  const shortDebt = rawNumber(row.shortLongTermDebt ?? row.shortTermDebt);
  const totalDebt = pick(rawNumber(row.totalDebt), sum([longDebt, shortDebt]));
  return {
    endDate: rawDate(row.endDate) ?? undefined,
    equity: rawNumber(row.totalStockholderEquity ?? row.stockholderEquity),
    totalDebt,
    totalAssets: rawNumber(row.totalAssets),
    currentAssets: rawNumber(row.totalCurrentAssets),
    currentLiab: rawNumber(row.totalCurrentLiabilities),
    cash: rawNumber(row.cash ?? row.cashAndCashEquivalents),
  };
}

function parseCashflow(row: Record<string, unknown>): Partial<PeriodRow> {
  const ocf = rawNumber(row.totalCashFromOperatingActivities ?? row.operatingCashflow);
  const capex = rawNumber(row.capitalExpenditures);
  const fcf = ocf != null && capex != null ? ocf + capex : rawNumber(row.freeCashFlow);
  return {
    endDate: rawDate(row.endDate) ?? undefined,
    ocf,
    capex,
    fcf,
  };
}

function mergePeriod(target: PeriodRow, extra: Partial<PeriodRow>): PeriodRow {
  return {
    ...target,
    revenue: pick(target.revenue, extra.revenue),
    pat: pick(target.pat, extra.pat),
    eps: pick(target.eps, extra.eps),
    ebit: pick(target.ebit, extra.ebit, extra.operatingIncome),
    ebitda: pick(target.ebitda, extra.ebitda),
    grossProfit: pick(target.grossProfit, extra.grossProfit),
    operatingIncome: pick(target.operatingIncome, extra.operatingIncome, extra.ebit),
    equity: pick(target.equity, extra.equity),
    totalDebt: pick(target.totalDebt, extra.totalDebt),
    totalAssets: pick(target.totalAssets, extra.totalAssets),
    currentAssets: pick(target.currentAssets, extra.currentAssets),
    currentLiab: pick(target.currentLiab, extra.currentLiab),
    cash: pick(target.cash, extra.cash),
    ocf: pick(target.ocf, extra.ocf),
    capex: pick(target.capex, extra.capex),
    fcf: pick(target.fcf, extra.fcf),
  };
}

function collectPeriods(
  incomeRows: Record<string, unknown>[],
  balanceRows: Record<string, unknown>[],
  cashRows: Record<string, unknown>[],
): PeriodRow[] {
  const byDate = new Map<number, PeriodRow>();
  const ingest = (partial: Partial<PeriodRow>): void => {
    if (!partial.endDate) return;
    const key = utcMidnight(partial.endDate).getTime();
    const existing = byDate.get(key);
    const base: PeriodRow = existing ?? {
      endDate: utcMidnight(partial.endDate),
      revenue: null,
      pat: null,
      eps: null,
      ebit: null,
      ebitda: null,
      grossProfit: null,
      operatingIncome: null,
      equity: null,
      totalDebt: null,
      totalAssets: null,
      currentAssets: null,
      currentLiab: null,
      cash: null,
      ocf: null,
      capex: null,
      fcf: null,
    };
    byDate.set(key, mergePeriod(base, partial));
  };
  for (const row of incomeRows) ingest(parseIncome(row));
  for (const row of balanceRows) ingest(parseBalance(row));
  for (const row of cashRows) ingest(parseCashflow(row));
  return [...byDate.values()].sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
}

function findPriorYear(rows: PeriodRow[], date: Date): PeriodRow | undefined {
  const target = date.getTime() - 365.25 * DAY_MS;
  let best: PeriodRow | undefined;
  let bestDiff = YOY_MATCH_DAYS * DAY_MS;
  for (const row of rows) {
    const diff = Math.abs(row.endDate.getTime() - target);
    if (diff <= bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }
  return best;
}

function ttm(rows: PeriodRow[], index: number, field: keyof PeriodRow): number | null {
  if (index < 3) return null;
  const window = rows.slice(index - 3, index + 1);
  const values = window.map((row) => {
    const value = row[field];
    return typeof value === 'number' ? value : null;
  });
  return values.every((value) => value != null) ? sum(values) : null;
}

/** Display-only 0–100 rubric. The model uses raw columns, not this score. */
export function computeDisplayScore(row: {
  revYoy: number | null;
  patYoy: number | null;
  roe: number | null;
  netMargin: number | null;
  debtEquity: number | null;
  currentRatio: number | null;
  ocfPat: number | null;
  trailingPe: number | null;
}): number | null {
  const pieces: number[] = [];
  if (row.revYoy != null) pieces.push(mapRange(row.revYoy, -0.1, 0.4, 0, 22));
  else if (row.patYoy != null) pieces.push(mapRange(row.patYoy, -0.15, 0.4, 0, 22));
  if (row.roe != null) pieces.push(mapRange(row.roe, 0, 0.25, 0, 22));
  if (row.netMargin != null) pieces.push(mapRange(row.netMargin, 0, 0.2, 0, 16));
  if (row.debtEquity != null) pieces.push(mapRange(row.debtEquity, 2.5, 0, 0, 12));
  if (row.currentRatio != null) pieces.push(mapRange(row.currentRatio, 0.8, 2, 0, 8));
  if (row.ocfPat != null) pieces.push(mapRange(row.ocfPat, 0, 1.2, 0, 12));
  if (row.trailingPe != null && row.trailingPe > 0) {
    const distance = Math.abs(Math.log(row.trailingPe / 18));
    pieces.push(clip(8 - distance * 6, 0, 8));
  }
  if (pieces.length < 3) return null;
  const scale = 100 / 100;
  const total = pieces.reduce((sumParts, value) => sumParts + value, 0) * scale;
  return Math.round(clip(total, 0, 100) * 10) / 10;
}

function holdingFraction(node: unknown): number | null {
  const value = rawNumber(node);
  if (value == null) return null;
  if (value > 1.5) return value / 100;
  return value;
}

export function emptySnapshot(
  symbol: string,
  asOfDate: Date,
  source: string,
): FundamentalSnapshotInput {
  return {
    symbol,
    asOfDate: utcMidnight(asOfDate),
    availableAt: utcMidnight(asOfDate),
    source,
    sector: null,
    revenue: null,
    pat: null,
    eps: null,
    ebit: null,
    ebitda: null,
    equity: null,
    totalDebt: null,
    totalAssets: null,
    currentAssets: null,
    currentLiab: null,
    cash: null,
    ocf: null,
    capex: null,
    fcf: null,
    revYoy: null,
    patYoy: null,
    epsYoy: null,
    opMargin: null,
    netMargin: null,
    grossMargin: null,
    ebitdaMargin: null,
    roe: null,
    roa: null,
    roce: null,
    debtEquity: null,
    currentRatio: null,
    cashRatio: null,
    ocfPat: null,
    fcfGrowth: null,
    fcfMargin: null,
    trailingEps: null,
    bookValue: null,
    trailingPe: null,
    priceToBook: null,
    sectorMedianPe: null,
    promoterHolding: null,
    institutionHolding: null,
    displayScore: null,
  };
}

export function hasStatementFundamentals(row: FundamentalSnapshotInput): boolean {
  return row.revenue != null || row.pat != null || row.equity != null || row.eps != null;
}

function liveSnapshotFromYahoo(input: {
  symbol: string;
  sector: string | null;
  financial: Record<string, unknown>;
  livePe: number | null;
  livePb: number | null;
  liveEps: number | null;
  liveBook: number | null;
  liveRevGrowth: number | null;
  liveEarnGrowth: number | null;
  liveOpMargin: number | null;
  liveNetMargin: number | null;
  liveGross: number | null;
  liveEbitdaMargin: number | null;
  liveRoe: number | null;
  liveRoa: number | null;
  debtEquityLive: number | null;
  liveCurrent: number | null;
  promoter: number | null;
  institution: number | null;
}): FundamentalSnapshotInput[] {
  const signals = [
    input.livePe,
    input.livePb,
    input.liveEps,
    input.liveBook,
    input.liveRevGrowth,
    input.liveRoe,
    input.liveNetMargin,
    rawNumber(input.financial.totalRevenue),
  ].filter((value) => value != null);
  if (signals.length < 2) return [];
  const asOf = utcMidnight(new Date());
  const row = emptySnapshot(input.symbol, asOf, 'yahoo-live');
  row.availableAt = asOf;
  row.sector = input.sector;
  row.revenue = rawNumber(input.financial.totalRevenue);
  row.ebitda = rawNumber(input.financial.ebitda);
  row.totalDebt = rawNumber(input.financial.totalDebt);
  row.revYoy = input.liveRevGrowth;
  row.patYoy = input.liveEarnGrowth;
  row.epsYoy = input.liveEarnGrowth;
  row.opMargin = input.liveOpMargin;
  row.netMargin = input.liveNetMargin;
  row.grossMargin = input.liveGross;
  row.ebitdaMargin = input.liveEbitdaMargin;
  row.roe = input.liveRoe;
  row.roa = input.liveRoa;
  row.debtEquity = input.debtEquityLive;
  row.currentRatio = input.liveCurrent;
  row.trailingEps = input.liveEps;
  row.bookValue = input.liveBook;
  row.trailingPe = input.livePe;
  row.priceToBook = input.livePb;
  row.promoterHolding = input.promoter;
  row.institutionHolding = input.institution;
  row.displayScore = computeDisplayScore(row);
  return [row];
}

export function parseQuoteSummary(symbol: string, payload: unknown): FundamentalSnapshotInput[] {
  const root = asRecord(payload);
  const summary = asRecord(root.quoteSummary ?? root);
  const result = Array.isArray(summary.result) ? asRecord(summary.result[0]) : summary;
  if (!result || Object.keys(result).length === 0) return [];

  const incomeQ = statementList(result.incomeStatementHistoryQuarterly, 'incomeStatementHistory');
  const balanceQ = statementList(result.balanceSheetHistoryQuarterly, 'balanceSheetStatements');
  const cashQ = statementList(result.cashflowStatementHistoryQuarterly, 'cashflowStatements');
  const incomeA = statementList(result.incomeStatementHistory, 'incomeStatementHistory');
  const balanceA = statementList(result.balanceSheetHistory, 'balanceSheetStatements');
  const cashA = statementList(result.cashflowStatementHistory, 'cashflowStatements');

  let periods = collectPeriods(incomeQ, balanceQ, cashQ);
  if (periods.length === 0) {
    periods = collectPeriods(incomeA, balanceA, cashA);
  }

  const stats = asRecord(result.defaultKeyStatistics);
  const financial = asRecord(result.financialData);
  const detail = asRecord(result.summaryDetail);
  const profile = asRecord(result.assetProfile);
  const holders = asRecord(result.majorHoldersBreakdown);
  const sector =
    typeof profile.sector === 'string' && profile.sector.trim() ? profile.sector : null;
  const shares = rawNumber(stats.sharesOutstanding);
  const livePe = pick(rawNumber(stats.trailingPE), rawNumber(detail.trailingPE));
  const livePb = pick(rawNumber(stats.priceToBook), rawNumber(detail.priceToBook));
  const liveEps = rawNumber(stats.trailingEps);
  const liveBook = rawNumber(stats.bookValue);
  const liveRevGrowth = rawNumber(financial.revenueGrowth);
  const liveEarnGrowth = rawNumber(financial.earningsGrowth ?? financial.earningsQuarterlyGrowth);
  const liveOpMargin = rawNumber(financial.operatingMargins);
  const liveNetMargin = rawNumber(financial.profitMargins);
  const liveGross = rawNumber(financial.grossMargins);
  const liveEbitdaMargin = rawNumber(financial.ebitdaMargins);
  const liveRoe = rawNumber(financial.returnOnEquity);
  const liveRoa = rawNumber(financial.returnOnAssets);
  const liveDe = rawNumber(financial.debtToEquity);
  const debtEquityLive = liveDe != null && liveDe > 5 ? liveDe / 100 : liveDe;
  const liveCurrent = rawNumber(financial.currentRatio);
  const promoter = holdingFraction(holders.insidersPercentHeld);
  const institution = holdingFraction(holders.institutionsPercentHeld);

  if (periods.length === 0) {
    return liveSnapshotFromYahoo({
      symbol,
      sector,
      financial,
      livePe,
      livePb,
      liveEps,
      liveBook,
      liveRevGrowth,
      liveEarnGrowth,
      liveOpMargin,
      liveNetMargin,
      liveGross,
      liveEbitdaMargin,
      liveRoe,
      liveRoa,
      debtEquityLive,
      liveCurrent,
      promoter,
      institution,
    });
  }

  const snapshots: FundamentalSnapshotInput[] = periods.map((period, index) => {
    const prior = findPriorYear(periods, period.endDate);
    const ttmRev = ttm(periods, index, 'revenue') ?? period.revenue;
    const ttmPat = ttm(periods, index, 'pat') ?? period.pat;
    const ttmEbit = ttm(periods, index, 'ebit') ?? period.ebit;
    const ttmOcf = ttm(periods, index, 'ocf') ?? period.ocf;
    const ttmCapex = ttm(periods, index, 'capex') ?? period.capex;
    const ttmFcf = pick(
      ttm(periods, index, 'fcf'),
      ttmOcf != null && ttmCapex != null ? ttmOcf + ttmCapex : null,
      period.fcf,
      period.ocf != null && period.capex != null ? period.ocf + period.capex : null,
    );
    const priorTtmRev = prior
      ? (ttm(periods, periods.indexOf(prior), 'revenue') ?? prior.revenue)
      : null;
    const priorTtmPat = prior ? (ttm(periods, periods.indexOf(prior), 'pat') ?? prior.pat) : null;
    const priorTtmOcf = prior ? (ttm(periods, periods.indexOf(prior), 'ocf') ?? prior.ocf) : null;
    const priorTtmCapex = prior
      ? (ttm(periods, periods.indexOf(prior), 'capex') ?? prior.capex)
      : null;
    const priorFcf =
      priorTtmOcf != null && priorTtmCapex != null
        ? priorTtmOcf + priorTtmCapex
        : prior?.ocf != null && prior.capex != null
          ? prior.ocf + prior.capex
          : null;
    const trailingEps = pick(ratio(ttmPat, shares), period.eps, liveEps);
    const bookValue = pick(ratio(period.equity, shares), liveBook);
    const capitalEmployed =
      period.equity != null || period.totalDebt != null
        ? (period.equity ?? 0) + (period.totalDebt ?? 0) - (period.cash ?? 0)
        : null;

    const latest = index === periods.length - 1;
    const row: FundamentalSnapshotInput = {
      symbol,
      asOfDate: period.endDate,
      availableAt: availableAtFromPeriodEnd(period.endDate),
      source: 'yahoo',
      sector,
      revenue: ttmRev,
      pat: ttmPat,
      eps: trailingEps,
      ebit: ttmEbit,
      ebitda: period.ebitda,
      equity: period.equity,
      totalDebt: period.totalDebt,
      totalAssets: period.totalAssets,
      currentAssets: period.currentAssets,
      currentLiab: period.currentLiab,
      cash: period.cash,
      ocf: ttmOcf,
      capex: ttmCapex,
      fcf: ttmFcf,
      revYoy: pick(yoy(ttmRev, priorTtmRev), yoy(period.revenue, prior?.revenue ?? null)),
      patYoy: pick(yoy(ttmPat, priorTtmPat), yoy(period.pat, prior?.pat ?? null)),
      epsYoy: yoy(trailingEps, prior ? pick(ratio(priorTtmPat, shares), prior.eps) : null),
      opMargin: pick(ratio(ttmEbit, ttmRev), ratio(period.operatingIncome, period.revenue)),
      netMargin: ratio(ttmPat, ttmRev),
      grossMargin: ratio(period.grossProfit, period.revenue),
      ebitdaMargin: ratio(period.ebitda, period.revenue),
      roe: ratio(ttmPat, period.equity),
      roa: ratio(ttmPat, period.totalAssets),
      roce: ratio(
        ttmEbit,
        capitalEmployed != null && capitalEmployed !== 0 ? capitalEmployed : null,
      ),
      debtEquity: ratio(period.totalDebt, period.equity),
      currentRatio: ratio(period.currentAssets, period.currentLiab),
      cashRatio: ratio(period.cash, period.currentLiab),
      ocfPat: ratio(ttmOcf, ttmPat),
      fcfGrowth: yoy(ttmFcf, priorFcf),
      fcfMargin: ratio(ttmFcf, ttmRev),
      trailingEps,
      bookValue,
      trailingPe: latest ? livePe : null,
      priceToBook: latest ? livePb : null,
      sectorMedianPe: null,
      promoterHolding: latest ? promoter : null,
      institutionHolding: latest ? institution : null,
      displayScore: null,
    };
    if (latest) {
      row.revYoy = pick(row.revYoy, liveRevGrowth);
      row.patYoy = pick(row.patYoy, liveEarnGrowth);
      row.epsYoy = pick(row.epsYoy, liveEarnGrowth);
      row.opMargin = pick(row.opMargin, liveOpMargin);
      row.netMargin = pick(row.netMargin, liveNetMargin);
      row.grossMargin = pick(row.grossMargin, liveGross);
      row.ebitdaMargin = pick(row.ebitdaMargin, liveEbitdaMargin);
      row.roe = pick(row.roe, liveRoe);
      row.roa = pick(row.roa, liveRoa);
      row.debtEquity = pick(row.debtEquity, debtEquityLive);
      row.currentRatio = pick(row.currentRatio, liveCurrent);
    }
    row.displayScore = computeDisplayScore(row);
    return row;
  });

  return snapshots;
}

export class YahooFundamentalsClient {
  private chain: Promise<void> = Promise.resolve();
  private session: YahooSession | null = null;
  private sessionAt = 0;

  async fetchSnapshots(
    symbol: string,
    hint?: YahooSymbolHint,
  ): Promise<FundamentalSnapshotInput[]> {
    const tickers = yahooTickerCandidates(symbol, hint);
    let lastError: Error | null = null;
    for (const ticker of tickers) {
      try {
        const payload = await this.scheduled(() => this.fetchQuoteSummary(ticker));
        const snapshots = parseQuoteSummary(symbol, payload);
        if (snapshots.length === 0) {
          lastError = new Error(`${ticker} quoteSummary returned no statements`);
          continue;
        }
        return snapshots;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error(`No Yahoo fundamentals for ${symbol}`);
  }

  private scheduled<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS)),
      () => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS)),
    );
    return result;
  }

  private async ensureSession(force = false): Promise<YahooSession> {
    if (!force && this.session && Date.now() - this.sessionAt < SESSION_TTL_MS) {
      return this.session;
    }
    let cookie = '';
    const bootstrap = await axios.get('https://fc.yahoo.com', {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      timeout: 12_000,
      validateStatus: () => true,
      maxRedirects: 5,
    });
    cookie = appendSetCookie(cookie, bootstrap.headers['set-cookie']);
    const crumbRes = await axios.get('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain',
        Cookie: cookie,
      },
      timeout: 12_000,
      validateStatus: () => true,
      responseType: 'text',
    });
    cookie = appendSetCookie(cookie, crumbRes.headers['set-cookie']);
    const crumb = parseCrumb(crumbRes.data);
    if (crumbRes.status >= 400 || !isValidCrumb(crumb)) {
      throw new Error(`Yahoo crumb failed (${crumbRes.status})`);
    }
    this.session = { crumb, cookie };
    this.sessionAt = Date.now();
    return this.session;
  }

  private async requestQuoteSummary(ticker: string, session: YahooSession) {
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      Cookie: session.cookie,
    };
    const params = { modules: QUOTE_MODULES, crumb: session.crumb };
    try {
      return await axios.get(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`,
        { params, timeout: 12_000, headers },
      );
    } catch (error: unknown) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 404 || error.response?.status === 401)
      ) {
        return axios.get(
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`,
          { params, timeout: 12_000, headers },
        );
      }
      throw error;
    }
  }

  private async fetchQuoteSummary(ticker: string): Promise<unknown> {
    const response = await withRetry(
      async () => {
        try {
          return await this.requestQuoteSummary(ticker, await this.ensureSession());
        } catch (error: unknown) {
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            this.session = null;
            return this.requestQuoteSummary(ticker, await this.ensureSession(true));
          }
          throw error;
        }
      },
      { retries: 1, delayMs: 600, backoff: 1 },
    );
    return response.data;
  }
}
