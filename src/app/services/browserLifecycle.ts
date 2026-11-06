export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
};

export type BrowserEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

type PwaLifecycleCallbacks = {
  setInstalled: (installed: boolean) => void;
  setInstallPrompt: (event: BeforeInstallPromptEvent | null) => void;
  onInstalled: () => void;
};

/** Registers the browser's install-prompt lifecycle and returns complete cleanup. */
export function registerPwaInstallLifecycle(
  target: BrowserEventTarget,
  isStandalone: () => boolean,
  callbacks: PwaLifecycleCallbacks,
): () => void {
  callbacks.setInstalled(isStandalone());

  const onBeforeInstallPrompt: EventListener = event => {
    event.preventDefault();
    callbacks.setInstallPrompt(event as BeforeInstallPromptEvent);
  };
  const onInstalled: EventListener = () => {
    callbacks.setInstalled(true);
    callbacks.setInstallPrompt(null);
    callbacks.onInstalled();
  };

  target.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  target.addEventListener("appinstalled", onInstalled);
  return () => {
    target.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    target.removeEventListener("appinstalled", onInstalled);
  };
}

/** Keeps the app's connection indicator synchronized with browser connectivity events. */
export function registerConnectionStatusLifecycle(
  target: BrowserEventTarget,
  setOnline: (online: boolean) => void,
): () => void {
  const onOnline: EventListener = () => setOnline(true);
  const onOffline: EventListener = () => setOnline(false);
  target.addEventListener("online", onOnline);
  target.addEventListener("offline", onOffline);
  return () => {
    target.removeEventListener("online", onOnline);
    target.removeEventListener("offline", onOffline);
  };
}

type ForegroundRefreshInput = {
  documentTarget: BrowserEventTarget;
  windowTarget: BrowserEventTarget;
  isVisible: () => boolean;
  isOnline: () => boolean;
  refresh: () => unknown;
  lastRefreshAt: { current: number };
  now?: () => number;
  throttleMs?: number;
};

/** Refreshes active dashboard data on foreground events, with the existing 5-second throttle. */
export function registerForegroundRefreshLifecycle({
  documentTarget,
  windowTarget,
  isVisible,
  isOnline,
  refresh,
  lastRefreshAt,
  now = Date.now,
  throttleMs = 5000,
}: ForegroundRefreshInput): () => void {
  const refreshWhenVisible: EventListener = () => {
    if (!isVisible() || !isOnline()) return;
    const currentTime = now();
    if (currentTime - lastRefreshAt.current < throttleMs) return;
    lastRefreshAt.current = currentTime;
    void refresh();
  };

  documentTarget.addEventListener("visibilitychange", refreshWhenVisible);
  windowTarget.addEventListener("pageshow", refreshWhenVisible);
  return () => {
    documentTarget.removeEventListener("visibilitychange", refreshWhenVisible);
    windowTarget.removeEventListener("pageshow", refreshWhenVisible);
  };
}
