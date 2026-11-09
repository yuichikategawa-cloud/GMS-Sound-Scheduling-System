/// <reference lib="deno.ns" />

import {
  loadServantDirectoryData,
  type ServantDirectoryDataClient,
  type ServantDirectoryQueryResponse,
} from "../../src/features/servants/services/servantDirectory.ts";

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

interface RecordedQuery {
  table: "member_profiles" | "profiles";
  columns: "*" | "id,role,display_name,username";
}

function createClient(
  memberProfiles: ServantDirectoryQueryResponse,
  accountProfiles: ServantDirectoryQueryResponse,
): { client: ServantDirectoryDataClient; calls: RecordedQuery[] } {
  const calls: RecordedQuery[] = [];
  const responses = { member_profiles: memberProfiles, profiles: accountProfiles };
  const client = {
    from(table: "member_profiles" | "profiles") {
      return {
        select(columns: "*" | "id,role,display_name,username") {
          calls.push({ table, columns });
          return Promise.resolve(responses[table]);
        },
      };
    },
  } as ServantDirectoryDataClient;
  return { client, calls };
}

Deno.test("servant directory data loads member and account profiles using existing query contracts", async () => {
  const memberRows = [{ user_id: "servant-user", full_name: "Jordan Tan" }];
  const accountRows = [{ id: "servant-user", role: "servant", username: "jordan" }];
  const memberResponse = { data: memberRows, error: null };
  const accountResponse = { data: accountRows, error: null };
  const { client, calls } = createClient(memberResponse, accountResponse);

  const result = await loadServantDirectoryData(client);

  assertEqual(calls, [
    { table: "member_profiles", columns: "*" },
    { table: "profiles", columns: "id,role,display_name,username" },
  ], "The helper must preserve both table names and selected columns.");
  assertSame(result.memberProfiles, memberResponse, "Member profile result must pass through unchanged.");
  assertSame(result.accountProfiles, accountResponse, "Account profile result must pass through unchanged.");
});

Deno.test("servant directory data returns member-profile errors unchanged", async () => {
  const memberError = { code: "42501", message: "Member profile access denied." };
  const memberResponse = { data: null, error: memberError };
  const accountResponse = { data: [{ id: "user-1", role: "servant" }], error: null };
  const { client } = createClient(memberResponse, accountResponse);

  const result = await loadServantDirectoryData(client);

  assertSame(result.memberProfiles.error, memberError, "Member profile error identity must be preserved.");
  assertSame(result.accountProfiles, accountResponse, "The other query result must remain available.");
});

Deno.test("servant directory data returns account-profile errors unchanged", async () => {
  const memberResponse = { data: [{ user_id: "user-1", full_name: "Jordan Tan" }], error: null };
  const accountError = { code: "42P01", message: "Account profiles are not available." };
  const accountResponse = { data: null, error: accountError };
  const { client } = createClient(memberResponse, accountResponse);

  const result = await loadServantDirectoryData(client);

  assertSame(result.memberProfiles, memberResponse, "Member rows must remain available.");
  assertSame(result.accountProfiles.error, accountError, "Account profile error identity must be preserved.");
});

Deno.test("servant directory data retains empty successful results distinctly from query errors", async () => {
  const memberResponse = { data: [], error: null };
  const accountResponse = { data: [], error: null };
  const { client } = createClient(memberResponse, accountResponse);

  const result = await loadServantDirectoryData(client);

  assertEqual(result.memberProfiles.data, [], "An empty successful member list must remain empty, not become an error.");
  assertEqual(result.accountProfiles.data, [], "An empty successful account list must remain empty, not become an error.");
  assertEqual(result.memberProfiles.error, null, "Successful empty member results must retain null error.");
  assertEqual(result.accountProfiles.error, null, "Successful empty account results must retain null error.");
});
