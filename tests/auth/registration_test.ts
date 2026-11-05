/// <reference lib="deno.ns" />

import { buildSignupMetadata } from "../../src/features/auth/services/registration.ts";

function createValidFormData(): FormData {
  const data = new FormData();
  data.set("username", "  Sound.User ");
  data.set("full_name", "  GMS Member  ");
  data.set("email", " member@example.com ");
  data.set("gender", "Prefer not to say");
  data.set("date_of_birth", "1995-04-12");
  data.set("nij", " NIJ-123 ");
  data.set("phone_number", " +628123456789 ");
  data.set("domicile_area", "Alam Sutera");
  data.set("domicile_other", "");
  data.set("cg_category", "Young Adult");
  data.set("cg_status", "Member");
  data.set("cg_number", " CG-02 ");
  data.append("cg_days", "Sunday");
  data.append("cg_days", "Saturday");
  data.set("cg_time", "19:00");
  data.set("team_leader_name", "Leader One");
  data.set("coach_name", "Coach One");
  data.set("cg_leader_name", "CG Leader One");
  data.set("leader_phone_numbers", " +628111111111, +628222222222; +628333333333\n+628444444444 ");
  return data;
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

function assertThrows(action: () => unknown, expectedMessage: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) return;
    throw new Error("Unexpected error: " + String(error));
  }
  throw new Error("Expected error: " + expectedMessage);
}

Deno.test("buildSignupMetadata normalizes identity fields and parses leader phone separators", () => {
  const metadata = buildSignupMetadata(createValidFormData());

  assertEqual(metadata.username, "sound.user", "Username should be trimmed and lowercased.");
  assertEqual(metadata.full_name, "GMS Member", "Full name should be trimmed.");
  assertEqual(metadata.email, "member@example.com", "Email should be trimmed.");
  assertEqual(metadata.nij, "NIJ-123", "NIJ should be trimmed.");
  assertEqual(metadata.cg_number, "CG-02", "CG number should be trimmed.");
  assertEqual(metadata.cg_days, ["Sunday", "Saturday"], "CG day order should be preserved.");
  assertEqual(
    metadata.leader_phone_numbers,
    ["+628111111111", "+628222222222", "+628333333333", "+628444444444"],
    "Leader phone numbers should split on commas, semicolons, and newlines."
  );
});

Deno.test("buildSignupMetadata requires at least one CG day", () => {
  const data = createValidFormData();
  data.delete("cg_days");
  assertThrows(() => buildSignupMetadata(data), "Please select at least one CG day.");
});

Deno.test("buildSignupMetadata requires an other domicile detail when Others is selected", () => {
  const data = createValidFormData();
  data.set("domicile_area", "Others");
  data.set("domicile_other", "   ");
  assertThrows(() => buildSignupMetadata(data), "Please specify your domicile area.");
});

Deno.test("buildSignupMetadata requires at least one leader phone number", () => {
  const data = createValidFormData();
  data.set("leader_phone_numbers", " , ; \n ");
  assertThrows(() => buildSignupMetadata(data), "Enter at least one leader phone number.");
});

Deno.test("buildSignupMetadata clears the current servant's own leadership name", () => {
  const cases = [
    ["Team Leader", "team_leader_name"],
    ["Coach", "coach_name"],
    ["CG Leader", "cg_leader_name"]
  ] as const;

  for (const [status, field] of cases) {
    const data = createValidFormData();
    data.set("cg_status", status);
    const metadata = buildSignupMetadata(data);
    assertEqual(metadata[field], "", status + " should not be required to name themselves as their own leader.");
  }
});
