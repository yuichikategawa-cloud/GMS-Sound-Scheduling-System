import { startLeaseKeeper } from "./leaseKeeper.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("lease keeper renews before an endpoint send when requested", async () => {
  let calls = 0;
  const keeper = startLeaseKeeper(async () => {
    calls++;
    return true;
  }, 60_000);

  assert(await keeper.renewNow(), "explicit renewal should succeed");
  assert(calls === 1, "renewal should be called once");
  assert(keeper.ownsLease(), "lease should remain owned");

  await keeper.stop();
});

Deno.test("lease keeper renews periodically during a long send", async () => {
  let calls = 0;
  const keeper = startLeaseKeeper(async () => {
    calls++;
    return true;
  }, 5);

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert(calls >= 2, "heartbeat should renew more than once");
  assert(keeper.ownsLease(), "successful heartbeat should retain ownership");

  await keeper.stop();
});

Deno.test("lease keeper fails closed when the database says the lease is lost", async () => {
  const keeper = startLeaseKeeper(async () => false, 60_000);

  assert(!(await keeper.renewNow()), "renewal should report lost ownership");
  assert(!keeper.ownsLease(), "worker must stop after losing ownership");
  assert(!(await keeper.renewNow()), "a lost lease must not be renewed again");

  await keeper.stop();
});

Deno.test("overlapping heartbeat and explicit renewal share one in-flight request", async () => {
  let calls = 0;
  let resolveRenewal: ((value: boolean) => void) | undefined;
  const keeper = startLeaseKeeper(
    () => {
      calls++;
      return new Promise<boolean>((resolve) => {
        resolveRenewal = resolve;
      });
    },
    60_000,
  );

  const first = keeper.renewNow();
  const second = keeper.renewNow();
  assert(calls === 1, "only one database renewal should be in flight");

  resolveRenewal?.(true);
  assert(await first, "first renewal should succeed");
  assert(await second, "overlapping renewal should share the successful result");

  await keeper.stop();
});

Deno.test("invalid heartbeat intervals are rejected", () => {
  let threw = false;
  try {
    startLeaseKeeper(async () => true, 0);
  } catch {
    threw = true;
  }
  assert(threw, "zero interval should be rejected");
});
