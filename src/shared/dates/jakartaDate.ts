/** Business calendar timezone for GMS schedules and deadlines. */
export const BUSINESS_TIME_ZONE = "Asia/Jakarta";

/**
 * Return the current business-calendar date as YYYY-MM-DD, independent of
 * the device timezone and locale. This is for date-only business rules.
 */
export function getJakartaDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Parse a date-only service value at local noon to avoid midnight DST edges. */
export function parseBusinessDateAtNoon(dateOnly: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw new RangeError(`Expected YYYY-MM-DD date, received: ${dateOnly}`);
  }
  const date = new Date(`${dateOnly}T12:00:00+07:00`);
  if (Number.isNaN(date.getTime()) || getJakartaDate(date) !== dateOnly) {
    throw new RangeError(`Invalid business date: ${dateOnly}`);
  }
  return date;
}
