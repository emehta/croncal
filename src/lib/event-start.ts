/**
 * Where a new event starts when the user hasn't picked a time: the next half
 * hour from now, as other calendars do, so a meeting made at 23:29 starts at
 * 23:30 rather than on that odd minute. On the half hour itself it stays.
 */
export function nextHalfHour(now: Date): Date {
  const start = new Date(now);
  start.setSeconds(0, 0);
  const minutes = start.getMinutes();
  if (minutes === 0 || minutes === 30) {
    if (now.getSeconds() === 0 && now.getMilliseconds() === 0) return start;
  }
  start.setMinutes(minutes < 30 ? 30 : 60);
  return start;
}
