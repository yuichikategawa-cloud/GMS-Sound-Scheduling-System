/// <reference lib="deno.ns" />

import { mapHistoricalRosterProfiles } from "../../src/features/schedule/services/historicalRosterProfiles.ts";
import type { Servant } from "../../src/types.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

function servant(id: string, full_name: string, active = true): Servant {
  return { id, full_name, active, auth_user_id: null };
}

Deno.test("historical roster maps primary roles by normalized full name, not spreadsheet row key", () => {
  const result = mapHistoricalRosterProfiles([
    servant("uuid-suluh", "  SULUH   ANDRILLA "),
    servant("uuid-frans", "Fransiskus Adrian Lesmana", false),
  ]);

  assertEqual(result.profiles, [
    {
      servant_id: "uuid-suluh",
      primary_role: "FOH",
      role_counts: { FOH: 161, Monitor: 2, Assistant: 9 },
      historical_assignments: 172,
      historical_serving_days: 59,
      history_as_of: "2026-11-01",
    },
    {
      servant_id: "uuid-frans",
      primary_role: "Assistant",
      role_counts: { FOH: 0, Monitor: 11, Assistant: 74 },
      historical_assignments: 85,
      historical_serving_days: 31,
      history_as_of: "2026-11-01",
    },
  ], "Names should normalize case and whitespace and carry historical role/workload counts without importing live active status.");
  assertEqual(result.matchedPrimaryRoleNames, ["Suluh Andrilla", "Fransiskus Adrian Lesmana"], "Primary-role roster entries should be mapped.");
});

Deno.test("historical roster excludes manual-only people from automatic assignment", () => {
  const result = mapHistoricalRosterProfiles([
    servant("uuid-david", "David Karel"),
    servant("uuid-deddy", " Deddy "),
    servant("uuid-kevin", "Kevin Award"),
  ]);

  assertEqual(result.autoAssignmentExcludedServantIds, ["uuid-david", "uuid-deddy", "uuid-kevin"], "Manual-only servant IDs should be derived from exact normalized names.");
  assertEqual(result.matchedManualOnlyNames, ["David Karel", "Deddy", "Kevin Award"], "All manual-only roster labels should match.");
  assertEqual(result.profiles.length, 0, "Manual-only people must not be treated as role-affinity profiles.");
});

Deno.test("historical roster reports unmatched and ambiguous names without guessing", () => {
  const result = mapHistoricalRosterProfiles([
    servant("uuid-a", "David Karel"),
    servant("uuid-b", "David Karel"),
    servant("uuid-c", "Deddy Two"),
  ]);

  assertEqual(result.autoAssignmentExcludedServantIds, [], "Ambiguous names must not silently exclude an arbitrary ID.");
  assertEqual(result.ambiguousNames, ["David Karel"], "Duplicate normalized directory names must be surfaced.");
  assertEqual(result.unmatchedManualOnlyNames, ["Deddy", "Kevin Award"], "Unmatched manual-only names must be surfaced for admin reconciliation.");
});

Deno.test("historical inactive color is not used to override current servant active state", () => {
  const result = mapHistoricalRosterProfiles([
    servant("uuid-yoga", "Yoga", true),
  ]);

  assertEqual(result.profiles.length, 1, "A name marked inactive in the workbook still maps to history when the live servant remains active.");
  assertEqual(result.profiles[0].servant_id, "uuid-yoga", "The exact current servant identity should receive the historical profile.");
  assertEqual(result.profiles[0].role_counts, { FOH: 28, Monitor: 7, Assistant: 9 }, "Historical assignments should be mapped even without a color-coded primary role.");
  assertEqual(result.autoAssignmentExcludedServantIds, [], "Historical inactive status must not be imported as a live hard block.");
});
