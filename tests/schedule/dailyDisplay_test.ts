/// <reference lib="deno.ns" />

import {
  DAILY_CATEGORY_TINTS,
  dailyChurchColor,
  dailyServiceCategory,
  dailyTeamTint
} from "../../src/features/schedule/services/dailyDisplay.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message + "\nExpected: " + String(expected) + "\nActual: " + String(actual));
}

Deno.test("dailyChurchColor preserves known church palette and deterministic fallback", () => {
  assertEqual(dailyChurchColor("GMS Alam Sutera"), "#405A78", "Alam Sutera uses its assigned color.");
  assertEqual(dailyChurchColor("BSD Church"), "#5B5076", "BSD uses its assigned color.");
  assertEqual(dailyChurchColor("Karawaci Church"), "#3F665F", "Karawaci uses its assigned color.");
  assertEqual(dailyChurchColor("Unknown Location"), dailyChurchColor("Unknown Location"), "Unknown locations use a stable fallback.");
});

Deno.test("dailyServiceCategory normalizes VSS and AOG service names", () => {
  assertEqual(dailyServiceCategory(" VSS "), "vss", "VSS should be trimmed and case-insensitive.");
  assertEqual(dailyServiceCategory("VSS Sunday"), "vss", "VSS-prefixed services should be categorized.");
  assertEqual(dailyServiceCategory("AOG Youth"), "aog", "AOG services should be categorized.");
  assertEqual(dailyServiceCategory("Sunday Service"), "regular", "Other services should be regular.");
});

Deno.test("dailyTeamTint is stable and handles missing servant identity", () => {
  assertEqual(dailyTeamTint(undefined, undefined), undefined, "Missing servant identity has no tint.");
  assertEqual(dailyTeamTint("servant-1", "Sound Member"), dailyTeamTint("servant-1", "Different display name"), "Servant IDs determine a stable tint.");
  assertEqual(dailyTeamTint(undefined, "Sound Member"), dailyTeamTint(undefined, "Sound Member"), "Names provide a stable fallback.");
});

Deno.test("daily category tints remain available for VSS and AOG", () => {
  assertEqual(typeof DAILY_CATEGORY_TINTS.vss, "string", "VSS tint should be defined.");
  assertEqual(typeof DAILY_CATEGORY_TINTS.aog, "string", "AOG tint should be defined.");
});
