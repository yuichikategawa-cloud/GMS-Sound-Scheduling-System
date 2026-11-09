/// <reference lib="deno.ns" />

import {
  buildWeekendScheduleRows,
  type WeekendGenerationInput,
  type WeekendServiceTemplate,
} from "../../src/features/schedule/services/weekendGeneration.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

const templates: WeekendServiceTemplate[] = [
  { id: "sat-main", day_of_week: 6, location_id: "loc-as", service_name: "Saturday Service", start_time: "17:00", end_time: "19:00" },
  { id: "sun-main", day_of_week: "0", location_id: "loc-bsd", service_name: "Sunday Service", start_time: "09:00", end_time: "11:00" },
  { id: "weekday", day_of_week: 1, location_id: "loc-as", service_name: "Monday Service", start_time: "19:00", end_time: "20:30" },
  { id: "not-selected", day_of_week: 6, location_id: "loc-bsd", service_name: "Youth Service", start_time: "16:00", end_time: "18:00" },
];

const base: WeekendGenerationInput = {
  startDate: "2026-11-07",
  weeks: 1,
  templateIds: ["sat-main", "sun-main"],
  templates,
};

Deno.test("weekend generation maps selected Saturday and Sunday templates to schedule rows", () => {
  const result = buildWeekendScheduleRows(base);
  assertEqual(result, {
    ok: true,
    rows: [
      { service_date: "2026-11-07", location_id: "loc-as", service_name: "Saturday Service", start_time: "17:00", end_time: "19:00" },
      { service_date: "2026-11-08", location_id: "loc-bsd", service_name: "Sunday Service", start_time: "09:00", end_time: "11:00" },
    ],
    selectedTemplateCount: 2,
    weekendCount: 1,
  }, "Selected weekend templates should produce the expected rows.");
});

Deno.test("weekend generation expands every selected template across multiple weekends", () => {
  const result = buildWeekendScheduleRows({ ...base, weeks: 2 });
  assertEqual(result.ok ? result.rows.map(row => row.service_date) : result, [
    "2026-11-07",
    "2026-11-08",
    "2026-11-14",
    "2026-11-15",
  ], "Each selected weekend template should be expanded for every requested week.");
});

Deno.test("weekend generation correctly crosses a year boundary", () => {
  const result = buildWeekendScheduleRows({ ...base, startDate: "2026-12-26", weeks: 2 });
  assertEqual(result.ok ? result.rows.map(row => row.service_date) : result, [
    "2026-12-26",
    "2026-12-27",
    "2027-01-02",
    "2027-01-03",
  ], "Date expansion should continue correctly into the next year.");
});

Deno.test("weekend generation requires a Saturday start date", () => {
  assertEqual(
    buildWeekendScheduleRows({ ...base, startDate: "2026-11-08" }),
    { ok: false, reason: "choose_saturday" },
    "A Sunday start date must be rejected.",
  );
});

Deno.test("weekend generation requires at least one selected template", () => {
  assertEqual(
    buildWeekendScheduleRows({ ...base, templateIds: [] }),
    { ok: false, reason: "select_template" },
    "An empty template selection must be rejected.",
  );
});

Deno.test("weekend generation rejects selections that contain no Saturday or Sunday services", () => {
  assertEqual(
    buildWeekendScheduleRows({ ...base, templateIds: ["weekday"] }),
    { ok: false, reason: "no_weekend_services" },
    "Weekday-only templates must not create weekend schedule rows.",
  );
});

Deno.test("weekend generation rejects malformed dates and invalid week counts", () => {
  assertEqual(
    buildWeekendScheduleRows({ ...base, startDate: "2026-02-31" }),
    { ok: false, reason: "invalid_date" },
    "Impossible calendar dates must be rejected.",
  );
  assertEqual(
    buildWeekendScheduleRows({ ...base, weeks: 0 }),
    { ok: false, reason: "invalid_weeks" },
    "A zero-week request must be rejected.",
  );
  assertEqual(
    buildWeekendScheduleRows({ ...base, weeks: 1.5 }),
    { ok: false, reason: "invalid_weeks" },
    "Fractional week counts must be rejected.",
  );
});

Deno.test("weekend generation does not mutate the template list or selected identifiers", () => {
  const input = {
    ...base,
    templateIds: [...base.templateIds],
    templates: base.templates.map(template => ({ ...template })),
  };
  const before = JSON.stringify(input);
  buildWeekendScheduleRows(input);
  assertEqual(JSON.stringify(input), before, "Generation must not mutate its inputs.");
});
