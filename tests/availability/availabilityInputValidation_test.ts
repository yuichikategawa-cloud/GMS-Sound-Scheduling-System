/// <reference lib="deno.ns" />
import {
  getInclusiveDateCount,
  validateServingPreferenceInput,
} from "../../src/features/availability/services/availabilityInputValidation.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message + " Expected " + String(expected) + ", got " + String(actual));
}

Deno.test("serving preference validation returns actionable messages instead of silently ignoring invalid input", () => {
  const base = {
    servantSelected: true,
    ruleType: "allowed_time_window" as const,
    daysOfWeek: [0],
    startTime: "07:00",
    endTime: "11:00",
    locationId: "",
    serviceNames: [],
  };
  assertEqual(validateServingPreferenceInput({ ...base, servantSelected: false }), "Select a servant before saving this serving preference.", "A missing servant needs feedback.");
  assertEqual(validateServingPreferenceInput({ ...base, daysOfWeek: [] }), "Select at least one allowed day.", "An empty weekday selection needs feedback.");
  assertEqual(validateServingPreferenceInput({ ...base, startTime: "11:00", endTime: "07:00" }), "Choose a valid time window. The end time must be later than the start time.", "A reversed time window needs feedback.");
  assertEqual(validateServingPreferenceInput({ ...base, startTime: "25:00" }), "Choose a valid time window. The end time must be later than the start time.", "An invalid time needs feedback.");
  assertEqual(validateServingPreferenceInput({ ...base, ruleType: "allowed_service_scope", locationId: "" }), "Choose a church location.", "A missing location needs feedback.");
  assertEqual(validateServingPreferenceInput({ ...base, ruleType: "allowed_service_scope", locationId: "loc-1", serviceNames: [] }), "Select at least one allowed service.", "An empty service selection needs feedback.");
  assertEqual(validateServingPreferenceInput(base), null, "A complete time preference should pass.");
});

Deno.test("bulk availability date range count is inclusive, rejects invalid ranges, and exposes the 370-day limit", () => {
  assertEqual(getInclusiveDateCount("2026-11-07", "2026-11-07"), 1, "A same-day range contains one day.");
  assertEqual(getInclusiveDateCount("2026-11-07", "2026-11-08"), 2, "End dates should be counted inclusively.");
  assertEqual(getInclusiveDateCount("2026-01-01", "2027-01-05"), 370, "A maximum supported range should count all dates.");
  assertEqual(getInclusiveDateCount("2026-01-01", "2027-01-06"), 371, "An overlong range must be detectable, not silently truncated.");
  assertEqual(getInclusiveDateCount("2026-02-30", "2026-03-01"), null, "Impossible calendar dates must be rejected.");
  assertEqual(getInclusiveDateCount("2026-11-08", "2026-11-07"), null, "Reversed date ranges must be rejected.");
});
