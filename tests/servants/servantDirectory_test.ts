/// <reference lib="deno.ns" />

import {
  buildServantAccountCandidates,
  type ServantDirectoryAccountProfile,
  type ServantDirectoryMember,
} from "../../src/features/servants/services/servantDirectory.ts";
import type { Servant } from "../../src/types.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message);
}

const members: ServantDirectoryMember[] = [
  { user_id: "servant-user", full_name: "Jordan Tan", email: "jordan@example.test" },
  { user_id: "admin-user", full_name: "Admin User", email: "admin@example.test" },
  { user_id: "missing-user", full_name: "No Account", email: "missing@example.test" },
  { user_id: "unlinked-servant-user", full_name: "Unlinked Servant", email: null },
];

const profiles: ServantDirectoryAccountProfile[] = [
  { id: "servant-user", role: "servant", username: "jordan" },
  { id: "admin-user", role: "admin", username: "administrator" },
  { id: "unlinked-servant-user", role: "servant", username: null },
];

const linkedServant: Servant = {
  id: "servant-1",
  full_name: "Jordan Tan",
  active: true,
  auth_user_id: "servant-user",
};

Deno.test("servant directory candidates include only accounts with servant role", () => {
  const candidates = buildServantAccountCandidates(members, profiles, [linkedServant]);
  assertEqual(
    candidates.map(candidate => candidate.user_id),
    ["servant-user", "unlinked-servant-user"],
    "Admin accounts and members without a matching profile must not appear.",
  );
});

Deno.test("servant directory candidates preserve member fields and resolve username and linked servant", () => {
  const candidates = buildServantAccountCandidates(members, profiles, [linkedServant]);
  assertEqual(candidates[0], {
    user_id: "servant-user",
    full_name: "Jordan Tan",
    email: "jordan@example.test",
    username: "jordan",
    linked_servant: linkedServant,
  }, "Candidate fields must match the existing App mapping.");
  assertSame(candidates[0].linked_servant, linkedServant, "The matched servant object must be retained.");
});

Deno.test("servant directory candidates preserve empty username fallback and null linked servant", () => {
  const candidates = buildServantAccountCandidates(members, profiles, []);
  assertEqual(candidates[1], {
    user_id: "unlinked-servant-user",
    full_name: "Unlinked Servant",
    email: null,
    username: "",
    linked_servant: null,
  }, "Missing username and linked-servant fallbacks must remain unchanged.");
});

Deno.test("servant directory candidate derivation does not mutate its inputs", () => {
  const memberSnapshot = JSON.stringify(members);
  const profileSnapshot = JSON.stringify(profiles);
  const servantSnapshot = JSON.stringify([linkedServant]);

  buildServantAccountCandidates(members, profiles, [linkedServant]);

  assertEqual(JSON.stringify(members), memberSnapshot, "Member directory input must remain unchanged.");
  assertEqual(JSON.stringify(profiles), profileSnapshot, "Account profile input must remain unchanged.");
  assertEqual(JSON.stringify([linkedServant]), servantSnapshot, "Servant input must remain unchanged.");
});
