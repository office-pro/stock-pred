/**
 * Bull-Run display helpers — format backend fields only.
 * Never compute probability, confidence, Best Pick, integrity, ranking, or Exec Ready.
 */

export type BullRunHorizon = '1D' | '1W' | '1M' | '3M' | '6M' | '12M';

/** Command Center Best Picks columns through +200%; Opportunities also use +500%. */
export const COMMAND_CENTER_DISPLAY_TARGETS = [0.1, 0.2, 0.3, 0.5, 1.0, 2.0] as const;
export const COMMAND_CENTER_OPPORTUNITY_TARGETS = [0.1, 0.2, 0.3, 0.5, 1.0, 2.0, 5.0] as const;
export const COMMAND_CENTER_HORIZONS: BullRunHorizon[] = ['1D', '1W', '1M', '3M', '6M', '12M'];

export function formatTargetLabel(t: number): string {
  if (!Number.isFinite(t)) return 'Not available';
  const pct = t * 100;
  if (Number.isInteger(pct)) return `+${pct}%`;
  return `+${pct.toFixed(0)}%`;
}

export function formatProbabilityPercent(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return 'Not available';
  return `${Math.round(p * 100)}%`;
}

/** Compact table cell: missing → em dash; empirical 0 → "0". */
export function formatProbabilityCell(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—';
  return String(Math.round(p * 100));
}

export function formatConfidence(conf: string | null | undefined): string {
  if (conf == null || conf === '' || conf === 'UNAVAILABLE') return 'Not available';
  return String(conf);
}

export function formatIntegrity(status: string | null | undefined): string {
  if (status == null || status === '') return 'Not available';
  return String(status);
}

export function formatExecReady(ready: boolean | null | undefined): string {
  if (ready === true) return 'YES';
  if (ready === false) return 'NO';
  return 'Not available';
}

export type MatrixCellLike = {
  targetReturn: number;
  status?: string;
  p?: number | null;
  conf?: string;
};

export type HorizonMatrixLike = {
  horizon: string;
  cells: MatrixCellLike[];
};

/** Lookup backend matrix cell for horizon + target — display only. */
export function lookupMatrixProbability(
  matrix: HorizonMatrixLike[] | undefined,
  horizon: string,
  targetReturn: number,
): number | null {
  if (!matrix?.length) return null;
  const row = matrix.find((m) => m.horizon === horizon);
  if (!row) return null;
  const cell = row.cells.find((c) => Math.abs(c.targetReturn - targetReturn) < 1e-9);
  if (!cell || cell.status === 'UNAVAILABLE') return null;
  if (cell.p == null || !Number.isFinite(cell.p)) return null;
  return cell.p;
}

export function lookupMatrixConfidence(
  matrix: HorizonMatrixLike[] | undefined,
  horizon: string,
  preferredTargets: readonly number[] = COMMAND_CENTER_DISPLAY_TARGETS,
): string | null {
  if (!matrix?.length) return null;
  const row = matrix.find((m) => m.horizon === horizon);
  if (!row) return null;
  for (const t of preferredTargets) {
    const cell = row.cells.find((c) => Math.abs(c.targetReturn - t) < 1e-9);
    if (cell?.status !== 'UNAVAILABLE' && cell?.conf) return cell.conf;
  }
  const any = row.cells.find((c) => c.conf && c.status !== 'UNAVAILABLE');
  return any?.conf ?? null;
}

export type CompactBullRunCell = {
  t: number;
  h: string;
  p: number;
  conf?: string;
  status?: string;
};

export function readBullRunV2Cells(ctx: Record<string, unknown> | undefined): CompactBullRunCell[] {
  const raw = ctx?.bullRunV2Cells;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is CompactBullRunCell =>
      c != null &&
      typeof c === 'object' &&
      typeof (c as CompactBullRunCell).t === 'number' &&
      typeof (c as CompactBullRunCell).h === 'string' &&
      typeof (c as CompactBullRunCell).p === 'number',
  );
}

export function matchCompactCell(
  cells: CompactBullRunCell[],
  targetReturn?: number,
  horizon?: string,
): CompactBullRunCell | undefined {
  if (!cells.length) return undefined;
  if (targetReturn == null && !horizon) return cells[0];
  return cells.find((c) => {
    if (c.status != null && c.status !== 'AVAILABLE') return false;
    if (targetReturn != null && Math.abs(c.t - targetReturn) > 1e-9) return false;
    if (horizon && c.h !== horizon) return false;
    return Number.isFinite(c.p);
  });
}

export function probabilityFromCompactCells(
  cells: CompactBullRunCell[],
  horizon: string,
  targetReturn: number,
): number | null {
  const hit = matchCompactCell(cells, targetReturn, horizon);
  return hit?.p ?? null;
}
