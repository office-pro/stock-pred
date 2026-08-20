const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const FUNDAMENTALS_MAX_AGE_MS = 7 * DAY_MS;

/** Calendar date of the current India session, stored as UTC midnight. */
export function istSessionUtcDay(now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

export function isFundamentalsFresh(
  availableAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!availableAt) return false;
  return now.getTime() - availableAt.getTime() <= FUNDAMENTALS_MAX_AGE_MS;
}

export function isIstSessionAsOf(asOfDate: Date | null | undefined, now = new Date()): boolean {
  if (!asOfDate) return false;
  return asOfDate.getTime() === istSessionUtcDay(now).getTime();
}

export function parseFullFlag(value?: string | boolean): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const raw = value.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}
