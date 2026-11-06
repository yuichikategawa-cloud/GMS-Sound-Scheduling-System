export interface RecurringAvailabilityRule {
  id?: string;
  servant_id: string;
  effective_from: string;
  effective_until?: string | null;
  pattern: string;
  status: string;
  notes?: string | null;
  weekday?: string | number | null;
  ordinal?: string | number | null;
}

export interface AvailabilityRecord {
  id?: string;
  servant_id: string;
  service_date: string;
  status: string;
  notes?: string | null;
  is_recurring?: boolean;
  rule_id?: string;
}

export interface VirtualAvailabilityRecord extends AvailabilityRecord {
  id: string;
  notes: string;
  is_recurring: true;
  rule_id: string | undefined;
}

export type RecurringAvailabilityRuleValidation =
  | { ok: true }
  | { ok: false; reason: "overlapping_rule" | "availability_conflict"; conflictDate?: string };

/**
 * Keeps the same local-noon date parsing and locale-based date formatting
 * used by the existing App implementation, avoiding UTC boundary shifts.
 */
function ruleDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function formatLocalDate(date: Date): string {
  return date.toLocaleDateString("en-CA");
}

function matchesPattern(rule: RecurringAvailabilityRule, date: Date): boolean {
  const day = date.getDay();
  const dayOfMonth = date.getDate();
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

  if (rule.pattern === "weekday") return day >= 1 && day <= 5;
  if (rule.pattern === "saturday") return day === 6;
  if (rule.pattern === "sunday") return day === 0;
  if (rule.pattern === "second_week") return dayOfMonth >= 8 && dayOfMonth <= 14;
  if (rule.pattern === "month_edges") return dayOfMonth <= 3 || dayOfMonth > lastDay - 3;
  if (rule.pattern === "nth_weekday") {
    const ordinal = Math.ceil(dayOfMonth / 7);
    const isLast = dayOfMonth + 7 > lastDay;
    return day === Number(rule.weekday) &&
      (Number(rule.ordinal) === 5 ? isLast : ordinal === Number(rule.ordinal));
  }

  return false;
}

/**
 * Expands a single recurring rule through the inclusive effective end date,
 * capped by the caller-supplied two-year horizon. An open-ended rule uses
 * that horizon as its end date. The caller owns horizon calculation so a
 * single load operation uses one consistent reference instant.
 */
export function expandRecurringAvailabilityRule(
  rule: RecurringAvailabilityRule,
  horizon: Date,
): VirtualAvailabilityRecord[] {
  const from = ruleDate(rule.effective_from);
  const end = rule.effective_until ? ruleDate(rule.effective_until) : new Date(horizon);
  const horizonEnd = new Date(horizon);
  const records: VirtualAvailabilityRecord[] = [];

  for (
    const cursor = new Date(from);
    cursor <= end && cursor <= horizonEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    if (!matchesPattern(rule, cursor)) continue;

    const date = formatLocalDate(cursor);
    records.push({
      id: `rule-${rule.id}-${date}`,
      servant_id: rule.servant_id,
      service_date: date,
      status: rule.status,
      notes: rule.notes || "Recurring restriction",
      is_recurring: true,
      rule_id: rule.id,
    });
  }

  return records;
}

/** Expands a list of rules without mutating the rules or supplied horizon. */
export function buildVirtualAvailability(
  rules: readonly RecurringAvailabilityRule[],
  horizon: Date,
): VirtualAvailabilityRecord[] {
  return rules.flatMap(rule => expandRecurringAvailabilityRule(rule, horizon));
}

function hasOverlappingRule(
  candidate: RecurringAvailabilityRule,
  existingRules: readonly RecurringAvailabilityRule[],
): boolean {
  return existingRules.some(existing =>
    existing.servant_id === candidate.servant_id &&
    existing.status !== candidate.status &&
    (!existing.effective_until || existing.effective_until >= candidate.effective_from) &&
    (!candidate.effective_until || candidate.effective_until >= existing.effective_from)
  );
}

/**
 * Checks a new rule using the original validation order and bounds:
 * first reject overlapping rules with a different status, then scan no
 * more than 740 calendar dates for explicit availability conflicts.
 */
export function validateRecurringAvailabilityRule(
  candidate: RecurringAvailabilityRule,
  existingRules: readonly RecurringAvailabilityRule[],
  availability: readonly AvailabilityRecord[],
  now: Date = new Date(),
): RecurringAvailabilityRuleValidation {
  if (hasOverlappingRule(candidate, existingRules)) {
    return { ok: false, reason: "overlapping_rule" };
  }

  const end = candidate.effective_until
    ? ruleDate(candidate.effective_until)
    : new Date(now);
  if (!candidate.effective_until) {
    end.setFullYear(now.getFullYear() + 2);
  }

  const cursor = ruleDate(candidate.effective_from);
  for (let index = 0; cursor <= end && index < 740; cursor.setDate(cursor.getDate() + 1), index += 1) {
    if (!matchesPattern(candidate, cursor)) continue;

    const date = formatLocalDate(cursor);
    const conflict = availability.some(record =>
      record.servant_id === candidate.servant_id &&
      record.service_date === date &&
      record.status !== candidate.status
    );

    if (conflict) {
      return { ok: false, reason: "availability_conflict", conflictDate: date };
    }
  }

  return { ok: true };
}
