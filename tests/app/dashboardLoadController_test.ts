/// <reference lib="deno.ns" />

import {
  createDashboardLoadController,
} from "../../src/app/services/dashboardLoadController.ts";
import type { DashboardData } from "../../src/app/services/dashboardData.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function dashboard(optionalErrors: string[] = []): DashboardData {
  return { optionalErrors } as DashboardData;
}

Deno.test("dashboard load controller preserves loading, message, warning, and hydration order", async () => {
  const events: string[] = [];
  const expected = dashboard(["Notifications could not be loaded."]);
  const controller = createDashboardLoadController({
    load: async userId => {
      events.push("load:" + userId);
      return expected;
    },
    hydrate: data => events.push(data === expected ? "hydrate" : "hydrate:unexpected"),
    setLoading: value => events.push("loading:" + value),
    clearMessage: () => events.push("clear-message"),
    setError: error => events.push("error:" + String(error)),
    reportOptionalErrors: errors => events.push("optional:" + errors.join("|")),
  });

  await controller.load("user-1");

  assertEqual(events, [
    "loading:true",
    "clear-message",
    "load:user-1",
    "optional:Notifications could not be loaded.",
    "hydrate",
    "loading:false",
  ], "A current successful load must preserve the established feedback and hydration sequence.");
});

Deno.test("dashboard load controller ignores a stale completion after sign-out invalidation", async () => {
  const pending = deferred<DashboardData>();
  const events: string[] = [];
  const controller = createDashboardLoadController({
    load: () => pending.promise,
    hydrate: () => events.push("hydrate"),
    setLoading: value => events.push("loading:" + value),
    clearMessage: () => events.push("clear-message"),
    setError: error => events.push("error:" + String(error)),
    reportOptionalErrors: () => events.push("optional"),
  });

  const inFlight = controller.load("old-user");
  controller.invalidate();
  pending.resolve(dashboard(["stale optional failure"]));
  await inFlight;

  assertEqual(events, [
    "loading:true",
    "clear-message",
    "loading:false",
  ], "An invalidated request must not hydrate, report warnings, or overwrite messages.");
});

Deno.test("dashboard load controller lets only the newest overlapping request update state", async () => {
  const first = deferred<DashboardData>();
  const second = deferred<DashboardData>();
  const pending = [first, second];
  const hydrated: DashboardData[] = [];
  const loading: boolean[] = [];
  const controller = createDashboardLoadController({
    load: () => pending.shift()!.promise,
    hydrate: data => hydrated.push(data),
    setLoading: value => loading.push(value),
    clearMessage: () => undefined,
    setError: () => undefined,
    reportOptionalErrors: () => undefined,
  });

  const firstLoad = controller.load("user-1");
  const secondLoad = controller.load("user-1");
  const staleData = dashboard();
  first.resolve(staleData);
  await firstLoad;

  assertEqual(hydrated, [], "An older overlapping response must not hydrate shared state.");
  assertEqual(loading, [true, true], "The older request must not clear loading while a newer request is active.");

  const currentData = dashboard();
  second.resolve(currentData);
  await secondLoad;

  assertEqual(hydrated, [currentData], "Only the latest request may hydrate dashboard data.");
  assertEqual(loading, [true, true, false], "The current request must own the final loading transition.");
});

Deno.test("dashboard load controller reports only the latest request error and releases loading", async () => {
  const failure = new Error("Dashboard unavailable.");
  const events: string[] = [];
  const controller = createDashboardLoadController({
    load: async () => {
      throw failure;
    },
    hydrate: () => events.push("hydrate"),
    setLoading: value => events.push("loading:" + value),
    clearMessage: () => events.push("clear-message"),
    setError: error => events.push(error === failure ? "error:expected" : "error:unexpected"),
    reportOptionalErrors: () => events.push("optional"),
  });

  await controller.load("user-1");

  assertEqual(events, [
    "loading:true",
    "clear-message",
    "error:expected",
    "loading:false",
  ], "A current failure must surface its message and always release loading.");
});
