/**
 * Batch detail must use snapshot-owned evidence when a batchId is present.
 * Never replace historical batch cells with current live Bull-Run / analogue APIs.
 */

export function shouldFetchLiveBatchIntelligence(batchId?: string | null): boolean {
  return !String(batchId ?? '').trim();
}

export function preferBatchSnapshotValue<T>(
  batchOwned: boolean,
  snapshotValue: T | null | undefined,
  liveValue: T | null | undefined,
): T | null | undefined {
  if (batchOwned) return snapshotValue;
  return liveValue ?? snapshotValue;
}
