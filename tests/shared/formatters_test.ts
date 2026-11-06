/// <reference lib="deno.ns" />

import {
  dayNameForTemplate,
  displayList,
  errorText,
  fmtDate,
  localDateKey,
  shortTime,
  today,
} from "../../src/shared/formatters.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

Deno.test("localDateKey formats local calendar components consistently", () => {
  assertEqual(localDateKey(new Date(2024, 1, 29, 12)), "2024-02-29", "Leap days must retain their local calendar date.");
  assertEqual(localDateKey(new Date(2027, 0, 1, 0)), "2027-01-01", "Year boundaries must use padded year-month-day output.");
  assertEqual(localDateKey(new Date(2026, 10, 7, 23, 59)), "2026-11-07", "Late-evening values must retain their local date.");
});

Deno.test("shared date helpers use local calendar dates without UTC midnight shifts", () => {
  const currentDate = today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) {
    throw new Error("today() must return a YYYY-MM-DD local date.");
  }

  const date = "2026-11-07";
  const expected = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date + "T12:00:00"));
  assertEqual(fmtDate(date), expected, "fmtDate must preserve the established local-noon display format.");
});

Deno.test("shared time helper truncates seconds and safely handles empty input", () => {
  assertEqual(shortTime("09:30:45"), "09:30", "Time display should retain hour and minute only.");
  assertEqual(shortTime("7:05"), "7:05", "Short time strings should remain unchanged.");
  assertEqual(shortTime(""), "", "An empty time should remain empty.");
  assertEqual(shortTime(undefined as unknown as string), "", "A missing time should use the empty fallback.");
});

Deno.test("template day labels distinguish Saturday and Sunday", () => {
  assertEqual(dayNameForTemplate(6), "Saturday", "Day six is Saturday.");
  assertEqual(dayNameForTemplate(0), "Sunday", "Day zero is Sunday.");
  assertEqual(dayNameForTemplate(1), "Sunday", "Unexpected day values retain the established Sunday fallback.");
});

Deno.test("errorText returns native Error messages", () => {
  assertEqual(errorText(new Error("network unavailable")), "network unavailable", "Native Error messages must be preserved.");
});

Deno.test("errorText combines structured database error fields and ignores non-string values", () => {
  assertEqual(
    errorText({ message: "permission denied", details: "row policy", hint: "contact admin", code: "42501", extra: 42 }),
    "permission denied · row policy · contact admin · 42501",
    "Structured database error fields must be presented in stable order.",
  );
});

Deno.test("errorText serializes plain objects and safely handles circular values", () => {
  assertEqual(errorText({ status: 409 }), '{"status":409}', "Plain error objects should use JSON serialization.");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assertEqual(errorText(circular), "An unknown error occurred.", "Circular error objects must use the fallback message.");
});

Deno.test("errorText stringifies primitive and null values", () => {
  assertEqual(errorText("offline"), "offline", "String errors should pass through.");
  assertEqual(errorText(503), "503", "Numeric errors should be stringified.");
  assertEqual(errorText(null), "null", "Null should be stringified consistently.");
});

Deno.test("displayList formats arrays and JSON-encoded arrays", () => {
  assertEqual(displayList(["FOH", "", null, "Monitor"]), "FOH, Monitor", "Array display should filter empty values.");
  assertEqual(displayList('["FOH",null,"Monitor",""]'), "FOH, Monitor", "JSON arrays should use the same display format.");
  assertEqual(displayList("[]"), "", "An empty JSON array should become an empty string.");
});

Deno.test("displayList preserves plain strings and safely handles unsupported values", () => {
  assertEqual(displayList("not-json"), "not-json", "Plain text should not be modified.");
  assertEqual(displayList(null), "", "Null values should display as empty.");
  assertEqual(displayList({ label: "FOH" }), "", "Objects should not be stringified as list values.");
});
