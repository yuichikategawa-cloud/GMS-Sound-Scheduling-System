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
    { servant_id: "uuid-suluh", primary_role: "FOH" },
    { servant_id: "uuid-frans", primary_role: "Assistant" },
  ], "Names should normalize case and whitespace while servant active state remains untouched.");
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

  assertEqual(result.profiles.length, 0, "Names marked inactive in the workbook have no primary-role color.");
  assertEqual(result.autoAssignmentExcludedServantIds, [], "Historical inactive status must not be imported as a live hard block.");
});
