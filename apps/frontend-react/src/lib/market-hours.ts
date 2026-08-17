/** NSE regular session in Asia/Kolkata: weekdays 09:15–15:30. IST has no DST. */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const SESSION_OPEN_MIN = 9 * 60 + 15;
const SESSION_CLOSE_MIN = 15 * 60 + 30;

function istClock(now: number): { weekday: number; minutes: number } {
  const ist = new Date(now + IST_OFFSET_MS);
  return {
    weekday: ist.getUTCDay(),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

/** True while the NSE cash market is in regular trading hours. */
export function isNseRegularSession(now = Date.now()): boolean {
  const { weekday, minutes } = istClock(now);
  if (weekday === 0 || weekday === 6) return false;
  return minutes >= SESSION_OPEN_MIN && minutes <= SESSION_CLOSE_MIN;
}
