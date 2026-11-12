/// <reference lib="deno.ns" />

import {
  createServantRecord,
  linkServantAccountRecord,
  loadServantRecords,
  loadServantLocationRoleRecords,
  setServantLocationRoles,
  setServantActive,
  setServantQualifiedRoles,
  type ServantManagementClient,
  type ServantManagementResponse,
  type ServantRecordsResponse,
  type ServantLocationRoleRecordsResponse,
} from "../../src/features/servants/services/servantManagement.ts";
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

interface RecordedCalls {
  from: string[];
  insert: unknown[];
  update: unknown[];
  eq: Array<{ column: string; value: string }>;
  rpc: Array<{ functionName: string; args: unknown }>;
  select: string[];
  order: string[];
}

function createFakeClient(
  response: ServantManagementResponse = { error: null },
  recordsResponse: ServantRecordsResponse = { data: [], error: null },
  locationRoleRecordsResponse: ServantLocationRoleRecordsResponse = { data: [], error: null },
): {
  client: ServantManagementClient;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = {
    from: [],
    insert: [],
    update: [],
    eq: [],
    rpc: [],
    select: [],
    order: [],
  };

  const client: ServantManagementClient = {
    from(tableName) {
      calls.from.push(tableName);
      if (tableName === "servant_location_roles") {
        return {
          select: columns => {
            calls.select.push(columns);
            return locationRoleRecordsResponse;
          },
        };
      }
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
        select: columns => {
          calls.select.push(columns);
          return {
            order: async column => {
              calls.order.push(column);
              return recordsResponse;
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

Deno.test("servant management loads church-specific role permission rows", async () => {
  const roleRows = [
    { servant_id: "servant-1", location_id: "karawaci", role: "FOH" as const },
    { servant_id: "servant-1", location_id: "alam", role: "Monitor" as const },
  ];
  const response = { data: roleRows, error: null };
  const { client, calls } = createFakeClient({ error: null }, { data: [], error: null }, response);
  const result = await loadServantLocationRoleRecords(client);

  assertEqual(calls.from, ["servant_location_roles"], "Church qualifications must load from the normalized permission table.");
  assertEqual(calls.select, ["*"], "The loader must retrieve the complete permission rows.");
  assertSame(result, response, "Permission records and database errors must pass through unchanged.");
});

Deno.test("servant management replaces a complete deduplicated church role matrix through the guarded admin RPC", async () => {
  const { client, calls } = createFakeClient();
  await setServantLocationRoles(client, "servant-123", {
    karawaci: ["FOH", "FOH"],
    alam: ["Monitor"],
    bsd: [],
  });

  assertEqual(calls.rpc, [{
    functionName: "admin_set_servant_location_roles",
    args: {
      p_servant_id: "servant-123",
      p_roles_by_location: {
        karawaci: ["FOH"],
        alam: ["Monitor"],
        bsd: [],
      },
    },
  }], "The admin RPC must receive the full church matrix with duplicate roles removed.");
  assertEqual(calls.from, [], "The role matrix must be saved transactionally through its admin RPC.");
});

Deno.test("servant management loads all servant columns ordered by full name", async () => {
  const servantRows: Servant[] = [
    { id: "servant-1", full_name: "Alicia Tan", active: true, auth_user_id: null },
    { id: "servant-2", full_name: "Jordan Tan", active: false, auth_user_id: "user-2" },
  ];
  const recordsResponse = { data: servantRows, error: null };
  const { client, calls } = createFakeClient({ error: null }, recordsResponse);

  const result = await loadServantRecords(client);

  assertEqual(calls.from, ["servants"], "Servant loading must target the existing servants table.");
  assertEqual(calls.select, ["*"], "Servant loading must retain the existing full-row selection.");
  assertEqual(calls.order, ["full_name"], "Servant loading must retain alphabetical name ordering.");
  assertSame(result, recordsResponse, "Servant query response must pass through unchanged.");
  assertSame(result.data, servantRows, "Servant data must not be copied or transformed.");
});

Deno.test("servant management preserves servant-list database errors", async () => {
  const databaseError = { code: "42501", message: "Servant records could not be loaded." };
  const recordsResponse = { data: null, error: databaseError };
  const { client } = createFakeClient({ error: null }, recordsResponse);

  const result = await loadServantRecords(client);

  assertSame(result.error, databaseError, "The caller must receive the original database error.");
  assertSame(result.data, null, "A failed required servant query must not fabricate rows.");
});

Deno.test("servant management preserves an empty successful servant list", async () => {
  const recordsResponse = { data: [] as Servant[], error: null };
  const { client } = createFakeClient({ error: null }, recordsResponse);

  const result = await loadServantRecords(client);

  assertEqual(result.data, [], "An empty successful servant list must remain empty.");
  assertSame(result.error, null, "An empty successful query must not be reported as an error.");
});

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

Deno.test("servant management saves unique qualified sound roles for one servant", async () => {
  const { client, calls } = createFakeClient();
  await setServantQualifiedRoles(client, "servant-123", ["FOH", "Monitor", "FOH"]);

  assertEqual(calls.update, [{ qualified_roles: ["FOH", "Monitor"] }], "Role qualifications should be deduplicated before updating.");
  assertEqual(calls.eq, [{ column: "id", value: "servant-123" }], "Role qualification updates must target the selected servant.");
  assertEqual(calls.insert, [], "Role qualifications must not create a separate servant record.");
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

Deno.test("servant management passes mutation database errors through unchanged", async () => {
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
