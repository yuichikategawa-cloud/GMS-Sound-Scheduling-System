/// <reference lib="deno.ns" />

import {
  createServantRecord,
  linkServantAccountRecord,
  setServantActive,
  type ServantManagementClient,
  type ServantManagementResponse,
} from "../../src/features/servants/services/servantManagement.ts";

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

interface RecordedCalls {
  from: string[];
  insert: unknown[];
  update: unknown[];
  eq: Array<{ column: string; value: string }>;
  rpc: Array<{ functionName: string; args: unknown }>;
}

function createFakeClient(response: ServantManagementResponse = { error: null }): {
  client: ServantManagementClient;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = {
    from: [],
    insert: [],
    update: [],
    eq: [],
    rpc: [],
  };

  const client: ServantManagementClient = {
    from(tableName) {
      calls.from.push(tableName);
      return {
        insert: async values => {
          calls.insert.push(values);
          return response;
        },
        update: values => {
          calls.update.push(values);
          return {
            eq: async (column, value) => {
              calls.eq.push({ column, value });
              return response;
            },
          };
        },
      };
    },
    rpc: async (functionName, args) => {
      calls.rpc.push({ functionName, args });
      return response;
    },
  };

  return { client, calls };
}

Deno.test("servant management creates an active servant with the existing row shape", async () => {
  const { client, calls } = createFakeClient();
  await createServantRecord(client, "Jordan Tan");

  assertEqual(calls.from, ["servants"], "Creation must target the existing servants table.");
  assertEqual(calls.insert, [{ full_name: "Jordan Tan", active: true }], "Creation must preserve the existing payload.");
  assertEqual(calls.update, [], "Creation must not issue an update.");
  assertEqual(calls.rpc, [], "Creation must not invoke an unrelated RPC.");
});

Deno.test("servant management changes only the active flag for the selected servant", async () => {
  for (const active of [true, false]) {
    const { client, calls } = createFakeClient();
    await setServantActive(client, "servant-123", active);

    assertEqual(calls.from, ["servants"], "Status changes must target the servants table.");
    assertEqual(calls.update, [{ active }], "Status changes must update only the active field.");
    assertEqual(calls.eq, [{ column: "id", value: "servant-123" }], "Status changes must filter by the selected servant ID.");
    assertEqual(calls.insert, [], "Status changes must not insert a new servant.");
    assertEqual(calls.rpc, [], "Status changes must not invoke an unrelated RPC.");
  }
});

Deno.test("servant management links through the existing admin RPC and trims verified NIJ", async () => {
  const { client, calls } = createFakeClient();
  await linkServantAccountRecord(client, {
    servantId: "servant-456",
    userId: "member-user-789",
    verifiedNij: "  NIJ-2026-0042  ",
  });

  assertEqual(calls.rpc, [{
    functionName: "admin_link_servant_account",
    args: {
      p_servant_id: "servant-456",
      p_user_id: "member-user-789",
      p_verified_nij: "NIJ-2026-0042",
    },
  }], "Linking must preserve the RPC name and exact parameter contract.");
  assertEqual(calls.from, [], "Linking must not write directly to servant or member tables.");
  assertEqual(calls.insert, [], "Linking must not issue a direct insert.");
  assertEqual(calls.update, [], "Linking must not issue a direct update.");
});

Deno.test("servant management passes database errors through unchanged", async () => {
  const databaseError = { code: "P0001", message: "The account cannot be linked to this servant." };
  const response = { error: databaseError };

  const createClient = createFakeClient(response);
  const statusClient = createFakeClient(response);
  const linkClient = createFakeClient(response);

  const createResult = await createServantRecord(createClient.client, "Jordan Tan");
  const statusResult = await setServantActive(statusClient.client, "servant-123", false);
  const linkResult = await linkServantAccountRecord(linkClient.client, {
    servantId: "servant-123",
    userId: "member-user-789",
    verifiedNij: "NIJ-2026-0042",
  });

  assertSame(createResult.error, databaseError, "Creation errors must remain unchanged.");
  assertSame(statusResult.error, databaseError, "Status update errors must remain unchanged.");
  assertSame(linkResult.error, databaseError, "RPC errors must remain unchanged.");
});
