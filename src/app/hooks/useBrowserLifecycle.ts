import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  registerConnectionStatusLifecycle,
  registerForegroundRefreshLifecycle,
  registerPwaInstallLifecycle,
  type BeforeInstallPromptEvent,
} from "../services/browserLifecycle";

type BrowserLifecycleInput = {
  profileId?: string | null;
  userId?: string;
  refreshData: () => unknown;
  setMessage: Dispatch<SetStateAction<string>>;
};

/** Owns PWA, connectivity, and foreground-refresh browser lifecycle for the app shell. */
export function useBrowserLifecycle({
  profileId,
  userId,
  refreshData,
  setMessage,
}: BrowserLifecycleInput) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const lastForegroundRefresh = useRef(0);
  const refreshDataRef = useRef(refreshData);
  refreshDataRef.current = refreshData;

  useEffect(() => registerPwaInstallLifecycle(
    window,
    () => window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    {
      setInstalled: setPwaInstalled,
      setInstallPrompt,
      onInstalled: () => setMessage("Sound Scheduling is installed on this device."),
    },
  ), [setMessage]);

  useEffect(() => registerConnectionStatusLifecycle(window, setIsOnline), []);

  useEffect(() => {
    if (!profileId || !userId) return;
    return registerForegroundRefreshLifecycle({
      documentTarget: document,
      windowTarget: window,
      isVisible: () => document.visibilityState === "visible",
      isOnline: () => navigator.onLine,
      refresh: () => refreshDataRef.current(),
      lastRefreshAt: lastForegroundRefresh,
    });
  }, [profileId, userId]);

  return {
    installPrompt,
    pwaInstalled,
    isOnline,
    clearInstallPrompt: () => setInstallPrompt(null),
  };
}
