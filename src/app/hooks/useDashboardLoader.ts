import { useCallback, useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { errorText } from "../../../shared/formatters";
import { loadDashboardData } from "../services/dashboardData";
import type { DashboardStateAction } from "../state/dashboardState";
import { createDashboardLoadController } from "../services/dashboardLoadController";

/** Owns dashboard read orchestration, feedback, hydration, and stale-request protection. */
export function useDashboardLoader({
  client,
  userId,
  dispatchDashboardState,
  setLoading,
  setMessage,
}: {
  client: typeof import("../../../supabase").supabase;
  userId?: string;
  dispatchDashboardState: Dispatch<DashboardStateAction>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
}) {
  const controller = useMemo(() => createDashboardLoadController({
    load: activeUserId => {
      if (!client) throw new Error("The dashboard data client is unavailable.");
      return loadDashboardData(client, activeUserId);
    },
    hydrate: data => dispatchDashboardState({ type: "hydrate", data }),
    setLoading,
    clearMessage: () => setMessage(""),
    setError: error => setMessage(errorText(error)),
    reportOptionalErrors: errors => {
      console.warn("Some optional GMS dashboard data could not be loaded:", errors);
    },
  }), [client, dispatchDashboardState, setLoading, setMessage]);

  // Invalidate in-flight work whenever the authenticated user changes or the hook unmounts.
  useEffect(() => () => controller.invalidate(), [controller, userId]);

  const loadData = useCallback(() => {
    if (!client || !userId) return Promise.resolve();
    return controller.load(userId);
  }, [client, controller, userId]);

  const invalidateDashboardLoad = useCallback(
    () => controller.invalidate(),
    [controller],
  );

  return { loadData, invalidateDashboardLoad };
}
