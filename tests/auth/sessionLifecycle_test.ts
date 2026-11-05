/// <reference lib="deno.ns" />

import { startAuthSessionLifecycle } from "../../src/features/auth/services/sessionLifecycle.ts";

type SessionCallback = (event: string, nextSession: unknown) => void;

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

function createHarness(getSession: () => Promise<{ data: { session: unknown }; error: unknown }>, signOut?: (options: { scope: "local" }) => Promise<unknown>) {
  const calls: string[] = [];
  const state = {
    sessions: [] as unknown[],
    messages: [] as string[],
    recoveryModes: [] as boolean[],
    loading: [] as boolean[],
    warnings: [] as string[],
    callback: null as SessionCallback | null,
    unsubscribed: false,
    signOutScopes: [] as string[]
  };

  const client = {
    auth: {
      onAuthStateChange(callback: SessionCallback) {
        calls.push("subscribe");
        state.callback = callback;
        return { data: { subscription: { unsubscribe: () => { state.unsubscribed = true; } } } };
      },
      getSession() {
        calls.push("getSession");
        return getSession();
      },
      signOut(options: { scope: "local" }) {
        state.signOutScopes.push(options.scope);
        return signOut ? signOut(options) : Promise.resolve({ error: null });
      }
    }
  };

  const lifecycle = startAuthSessionLifecycle(client, {
    setSession: value => state.sessions.push(value),
    setRecoveryMode: value => state.recoveryModes.push(value),
    setAuthLoading: value => state.loading.push(value),
    setMessage: value => state.messages.push(value),
    errorText: error => error instanceof Error ? error.message : String(error),
    warn: message => state.warnings.push(message)
  });

  return { calls, state, client, lifecycle };
}

Deno.test("auth lifecycle subscribes before restoring session and unsubscribes on stop", async () => {
  const restored = { user: { id: "restored-user" } };
  const harness = createHarness(() => Promise.resolve({ data: { session: restored }, error: null }));

  assertEqual(harness.calls, ["subscribe", "getSession"], "The auth listener must be registered before getSession.");
  await harness.lifecycle.ready;
  assertEqual(harness.state.sessions, [restored], "The stored session should be applied.");
  assertEqual(harness.state.loading, [false], "Auth initialization should release the loading state.");
  harness.lifecycle.stop();
  assertEqual(harness.state.unsubscribed, true, "Stopping the lifecycle should unsubscribe.");
});

Deno.test("PASSWORD_RECOVERY auth events enable the password recovery mode", async () => {
  const harness = createHarness(() => Promise.resolve({ data: { session: null }, error: null }));
  harness.state.callback?.("PASSWORD_RECOVERY", { user: { id: "recovery-user" } });
  await harness.lifecycle.ready;

  assertEqual(harness.state.recoveryModes, [true], "Password recovery events should enable recovery mode.");
  assertEqual(harness.state.sessions[0], { user: { id: "recovery-user" } }, "Auth events should update the session immediately.");
});

Deno.test("invalid stored refresh tokens are cleared locally and show a sign-in message", async () => {
  const harness = createHarness(() => Promise.resolve({
    data: { session: null },
    error: { status: 401, message: "Invalid refresh token" }
  }));
  await harness.lifecycle.ready;

  assertEqual(harness.state.signOutScopes, ["local"], "Invalid stored sessions must be cleared on this device only.");
  assertEqual(harness.state.sessions, [null], "The invalid stored session should be cleared from app state.");
  assertEqual(
    harness.state.messages,
    ["Your saved sign-in session has expired. Please sign in again."],
    "The user should be prompted to sign in again."
  );
  assertEqual(harness.state.loading, [false], "Auth initialization should release the loading state.");
});

Deno.test("non-refresh session errors warn and retain the returned session fallback", async () => {
  const fallback = { user: { id: "fallback-user" } };
  const error = { status: 503, message: "Temporary auth service outage" };
  const harness = createHarness(() => Promise.resolve({ data: { session: fallback }, error }));
  await harness.lifecycle.ready;

  assertEqual(harness.state.warnings, ["Unable to restore the saved GMS session."], "Unexpected auth errors should be logged.");
  assertEqual(harness.state.sessions, [fallback], "The prior fallback behavior should be retained.");
});

Deno.test("unmount cancellation prevents late session state updates", async () => {
  let resolveSession!: (value: { data: { session: unknown }; error: unknown }) => void;
  const pending = new Promise<{ data: { session: unknown }; error: unknown }>(resolve => { resolveSession = resolve; });
  const harness = createHarness(() => pending);

  harness.lifecycle.stop();
  resolveSession({ data: { session: { user: { id: "too-late" } } }, error: null });
  await harness.lifecycle.ready;

  assertEqual(harness.state.sessions, [], "A stopped lifecycle must not update session state.");
  assertEqual(harness.state.loading, [], "A stopped lifecycle must not update loading state.");
});
