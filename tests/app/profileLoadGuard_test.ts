/// <reference lib="deno.ns" />
import { createProfileLoadGuard } from "../../src/app/services/profileLoadGuard.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("profile load guard invalidates stale requests on a new identity and retry", () => {
  const guard = createProfileLoadGuard();
  const oldRequest = guard.begin();
  assert(guard.isCurrent(oldRequest), "The newest profile request should be current.");
  const nextIdentity = guard.begin();
  assert(!guard.isCurrent(oldRequest), "A prior account's response must become stale after identity changes.");
  assert(guard.isCurrent(nextIdentity), "The new account's request should be current.");
  guard.invalidate();
  assert(!guard.isCurrent(nextIdentity), "Effect cleanup must invalidate an in-flight profile response.");
});
