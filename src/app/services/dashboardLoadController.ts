import type { DashboardData } from "./dashboardData";

export interface DashboardLoadControllerDependencies {
  load(userId: string): Promise<DashboardData>;
  hydrate(data: DashboardData): void;
  setLoading(loading: boolean): void;
  clearMessage(): void;
  setError(error: unknown): void;
  reportOptionalErrors(errors: string[]): void;
}

export interface DashboardLoadController {
  load(userId: string): Promise<void>;
  invalidate(): void;
}

/**
 * Coordinates one dashboard request at a time.
 *
 * Every request receives a sequence number. A newer request or explicit
 * invalidation makes all older completions inert, preventing stale sessions
 * from hydrating the shared dashboard state or changing its loading/error UI.
 */
export function createDashboardLoadController(
  dependencies: DashboardLoadControllerDependencies,
): DashboardLoadController {
  let requestSequence = 0;

  function invalidate(): void {
    requestSequence += 1;
    dependencies.setLoading(false);
  }

  async function load(userId: string): Promise<void> {
    const requestId = ++requestSequence;
    dependencies.setLoading(true);
    dependencies.clearMessage();

    try {
      const dashboard = await dependencies.load(userId);
      if (requestId !== requestSequence) return;

      if (dashboard.optionalErrors.length > 0) {
        dependencies.reportOptionalErrors(dashboard.optionalErrors);
      }
      dependencies.hydrate(dashboard);
    } catch (error) {
      if (requestId === requestSequence) {
        dependencies.setError(error);
      }
    } finally {
      if (requestId === requestSequence) {
        dependencies.setLoading(false);
      }
    }
  }

  return { load, invalidate };
}
