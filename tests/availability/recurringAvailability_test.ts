/// <reference lib="deno.ns" />

import {
  buildVirtualAvailability,
  expandRecurringAvailabilityRule,
  validateRecurringAvailabilityRule,
  type AvailabilityRecord,
  type RecurringAvailabilityRule,
} from "../../src/features/availability/services/recurringAvailability.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

const horizon = new Date("2026-12-31T12:00:00");

function rule(overrides: Partial<RecurringAvailabilityRule> = {}): RecurringAvailabilityRule {
  return {
    id: "rule-1",
    servant_id: "servant-1",
    effective_from: "2026-11-02",
    effective_until: "2026-11-06",
    pattern: "weekday",
    status: "unavailable",
    notes: null,
    ...overrides,
  };
}

Deno.test("recurring availability expands weekdays from Monday through Friday", () => {
  const records = expandRecurringAvailabilityRule(rule(), horizon);
  assertEqual(
    records.map(record => record.service_date),
    ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
    "The weekday pattern should include every weekday in the inclusive range.",
  );
});

Deno.test("recurring availability distinguishes Saturday and Sunday patterns", () => {
  const saturday = expandRecurringAvailabilityRule(
    rule({ pattern: "saturday", effective_from: "2026-11-01", effective_until: "2026-11-15" }),
    horizon,
  );
  const sunday = expandRecurringAvailabilityRule(
    rule({ pattern: "sunday", effective_from: "2026-11-01", effective_until: "2026-11-15" }),
    horizon,
  );

  assertEqual(
    saturday.map(record => record.service_date),
    ["2026-11-07", "2026-11-14"],
    "Saturday rules should include Saturdays only.",
  );
  assertEqual(
    sunday.map(record => record.service_date),
    ["2026-11-01", "2026-11-08", "2026-11-15"],
    "Sunday rules should include Sundays only.",
  );
});

Deno.test("recurring availability expands the second week as calendar dates 8 through 14", () => {
  const records = expandRecurringAvailabilityRule(
    rule({
      pattern: "second_week",
      effective_from: "2026-11-07",
      effective_until: "2026-11-15",
    }),
    horizon,
  );

  assertEqual(
    records.map(record => record.service_date),
    ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"],
    "The second-week pattern should use day-of-month boundaries, not weekday ordinals.",
  );
});

Deno.test("recurring availability expands the first and last three days of a month", () => {
  const records = expandRecurringAvailabilityRule(
    rule({
      pattern: "month_edges",
      effective_from: "2026-02-01",
      effective_until: "2026-02-28",
    }),
    horizon,
  );

  assertEqual(
    records.map(record => record.service_date),
    ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-26", "2026-02-27", "2026-02-28"],
    "Month edges should include the first three and last three calendar dates.",
  );
});

Deno.test("recurring availability supports numbered and last weekday-of-month patterns", () => {
  const secondWednesday = expandRecurringAvailabilityRule(
    rule({
      pattern: "nth_weekday",
      weekday: 3,
      ordinal: 2,
      effective_from: "2026-11-01",
      effective_until: "2026-11-30",
    }),
    horizon,
  );
  const lastSaturday = expandRecurringAvailabilityRule(
    rule({
      pattern: "nth_weekday",
      weekday: 6,
      ordinal: 5,
      effective_from: "2026-11-01",
      effective_until: "2026-11-30",
    }),
    horizon,
  );

  assertEqual(
    secondWednesday.map(record => record.service_date),
    ["2026-11-11"],
    "Ordinal 2 should select the second Wednesday.",
  );
  assertEqual(
    lastSaturday.map(record => record.service_date),
    ["2026-11-28"],
    "Ordinal 5 should select the final matching weekday in the month.",
  );
});

Deno.test("recurring availability uses inclusive start/end dates and clamps to the supplied horizon", () => {
  const records = expandRecurringAvailabilityRule(
    rule({
      effective_from: "2026-11-02",
      effective_until: "2026-11-08",
    }),
    new Date("2026-11-04T12:00:00"),
  );

  assertEqual(
    records.map(record => record.service_date),
    ["2026-11-02", "2026-11-03", "2026-11-04"],
    "Expansion should include the start and horizon dates but not continue beyond the horizon.",
  );
});

Deno.test("open-ended rules use the supplied horizon and virtual rows preserve their display shape", () => {
  const openEndedRule = rule({
    effective_until: null,
    notes: null,
  });
  const records = buildVirtualAvailability([openEndedRule], new Date("2026-11-04T12:00:00"));

  assertEqual(
    records,
    [
      {
        id: "rule-rule-1-2026-11-02",
        servant_id: "servant-1",
        service_date: "2026-11-02",
        status: "unavailable",
        notes: "Recurring restriction",
        is_recurring: true,
        rule_id: "rule-1",
      },
      {
        id: "rule-rule-1-2026-11-03",
        servant_id: "servant-1",
        service_date: "2026-11-03",
        status: "unavailable",
        notes: "Recurring restriction",
        is_recurring: true,
        rule_id: "rule-1",
      },
      {
        id: "rule-rule-1-2026-11-04",
        servant_id: "servant-1",
        service_date: "2026-11-04",
        status: "unavailable",
        notes: "Recurring restriction",
        is_recurring: true,
        rule_id: "rule-1",
      },
    ],
    "Open-ended rules should use the two-year horizon supplied by the caller and keep the UI row shape.",
  );
});

Deno.test("unknown recurring patterns create no virtual availability records", () => {
  assertEqual(
    expandRecurringAvailabilityRule(rule({ pattern: "unknown" as RecurringAvailabilityRule["pattern"] }), horizon),
    [],
    "Unsupported patterns should not create restriction dates.",
  );
});

Deno.test("recurring rule validation rejects overlapping rules with different statuses", () => {
  const candidate = rule({
    effective_from: "2026-11-05",
    effective_until: "2026-11-10",
    status: "prefer_not",
  });
  const existing = rule({
    effective_from: "2026-11-01",
    effective_until: "2026-11-05",
    status: "unavailable",
  });

  assertEqual(
    validateRecurringAvailabilityRule(candidate, [existing], [], horizon),
    { ok: false, reason: "overlapping_rule" },
    "Inclusive date overlap with a different status should be rejected.",
  );
});

Deno.test("recurring rule validation ignores same-status and other-servant rules", () => {
  const candidate = rule({ status: "unavailable" });
  const sameStatus = rule({ status: "unavailable" });
  const otherServant = rule({ servant_id: "servant-2", status: "prefer_not" });

  assertEqual(
    validateRecurringAvailabilityRule(candidate, [sameStatus, otherServant], [], horizon),
    { ok: true },
    "Only a same-servant rule with an overlapping date range and different status is a rule conflict.",
  );
});

Deno.test("recurring rule validation reports the first explicit availability conflict", () => {
  const candidate = rule({ effective_from: "2026-11-02", effective_until: "2026-11-06" });
  const availability: AvailabilityRecord[] = [
    { servant_id: "servant-1", service_date: "2026-11-04", status: "available" },
    { servant_id: "servant-1", service_date: "2026-11-05", status: "available" },
    { servant_id: "servant-2", service_date: "2026-11-03", status: "available" },
  ];

  assertEqual(
    validateRecurringAvailabilityRule(candidate, [], availability, horizon),
    { ok: false, reason: "availability_conflict", conflictDate: "2026-11-04" },
    "The first matching date for the same servant with a different status should be returned.",
  );
});

Deno.test("recurring rule validation permits matching statuses and unrelated availability rows", () => {
  const candidate = rule({ effective_from: "2026-11-02", effective_until: "2026-11-06" });
  const availability: AvailabilityRecord[] = [
    { servant_id: "servant-1", service_date: "2026-11-04", status: "unavailable" },
    { servant_id: "servant-2", service_date: "2026-11-05", status: "available" },
  ];

  assertEqual(
    validateRecurringAvailabilityRule(candidate, [], availability, horizon),
    { ok: true },
    "Same-status entries and other servants must not block the recurring rule.",
  );
});

Deno.test("recurring rule conflict scanning preserves the original 740-date limit", () => {
  const candidate = rule({
    effective_from: "2026-01-01",
    effective_until: "2028-01-20",
    pattern: "weekday",
  });
  const availability: AvailabilityRecord[] = [
    { servant_id: "servant-1", service_date: "2028-01-11", status: "available" },
  ];

  assertEqual(
    validateRecurringAvailabilityRule(candidate, [], availability, new Date("2026-01-01T00:00:00")),
    { ok: true },
    "The original 740-iteration guard should remain in effect.",
  );
});

Deno.test("recurring availability helpers do not mutate rules, availability, or horizon inputs", () => {
  const rules = [rule()];
  const availability: AvailabilityRecord[] = [
    { servant_id: "servant-1", service_date: "2026-11-04", status: "available" },
  ];
  const horizonInput = new Date("2026-11-10T12:00:00");
  const before = JSON.stringify({ rules, availability, horizon: horizonInput.toISOString() });

  buildVirtualAvailability(rules, horizonInput);
  validateRecurringAvailabilityRule(rule(), rules, availability, horizonInput);

  assertEqual(
    JSON.stringify({ rules, availability, horizon: horizonInput.toISOString() }),
    before,
    "Recurring availability helpers should leave all supplied inputs unchanged.",
  );
});
