/// <reference lib="deno.ns" />

import {
  registerConnectionStatusLifecycle,
  registerForegroundRefreshLifecycle,
  registerPwaInstallLifecycle,
  type BeforeInstallPromptEvent,
} from "../../src/app/services/browserLifecycle.ts";

Deno.test("PWA lifecycle detects standalone mode, captures prompt, and handles installation", () => {
  const target = new EventTarget();
  let installed = false;
  let prompt: BeforeInstallPromptEvent | null = null;
  let installMessageCount = 0;

  const cleanup = registerPwaInstallLifecycle(target, () => true, {
    setInstalled: value => { installed = value; },
    setInstallPrompt: value => { prompt = value; },
    onInstalled: () => { installMessageCount += 1; },
  });

  if (!installed) throw new Error("Standalone mode should be detected on initialization.");
  const beforeInstall = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "accepted" }) },
  ) as BeforeInstallPromptEvent;
  target.dispatchEvent(beforeInstall);
  if (!beforeInstall.defaultPrevented) throw new Error("The browser install prompt should be deferred.");
  if (prompt !== beforeInstall) throw new Error("The install prompt event should be retained.");

  target.dispatchEvent(new Event("appinstalled"));
  if (!installed || prompt !== null || installMessageCount !== 1) {
    throw new Error("Installation should update state, clear the prompt, and notify App exactly once.");
  }

  cleanup();
  target.dispatchEvent(new Event("appinstalled"));
  if (installMessageCount !== 1) throw new Error("PWA listeners should be removed during cleanup.");
});

Deno.test("connection lifecycle reflects online and offline browser events and cleans up", () => {
  const target = new EventTarget();
  const states: boolean[] = [];
  const cleanup = registerConnectionStatusLifecycle(target, value => states.push(value));

  target.dispatchEvent(new Event("offline"));
  target.dispatchEvent(new Event("online"));
  cleanup();
  target.dispatchEvent(new Event("offline"));

  if (JSON.stringify(states) !== JSON.stringify([false, true])) {
    throw new Error("Only active online/offline events should update connection state.");
  }
});

Deno.test("foreground refresh requires visible online state and preserves the 5-second throttle", () => {
  const documentTarget = new EventTarget();
  const windowTarget = new EventTarget();
  let visible = true;
  let online = true;
  let currentTime = 6000;
  let refreshCount = 0;
  const lastRefreshAt = { current: 0 };

  const cleanup = registerForegroundRefreshLifecycle({
    documentTarget,
    windowTarget,
    isVisible: () => visible,
    isOnline: () => online,
    refresh: () => { refreshCount += 1; },
    lastRefreshAt,
    now: () => currentTime,
  });

  documentTarget.dispatchEvent(new Event("visibilitychange"));
  currentTime = 9000;
  windowTarget.dispatchEvent(new Event("pageshow"));
  if (refreshCount !== 1) throw new Error("Refreshes within 5 seconds should be throttled.");

  currentTime = 11000;
  windowTarget.dispatchEvent(new Event("pageshow"));
  visible = false;
  currentTime = 17000;
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  visible = true;
  online = false;
  currentTime = 23000;
  windowTarget.dispatchEvent(new Event("pageshow"));

  if (refreshCount !== 2) throw new Error("Hidden or offline pages must not refresh dashboard data.");
  cleanup();
  online = true;
  currentTime = 30000;
  windowTarget.dispatchEvent(new Event("pageshow"));
  if (refreshCount !== 2) throw new Error("Foreground listeners should be removed during cleanup.");
});
