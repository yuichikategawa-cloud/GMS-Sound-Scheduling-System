type AuthSessionClient = {
  auth: {
    onAuthStateChange(
      callback: (event: string, nextSession: unknown) => void
    ): { data: { subscription: { unsubscribe: () => void } } };
    getSession(): Promise<{
      data: { session: unknown };
      error: unknown;
    }>;
    signOut(options: { scope: "local" }): Promise<unknown>;
  };
};

type AuthSessionLifecycleHandlers = {
  setSession: (session: unknown) => void;
  setRecoveryMode: (enabled: boolean) => void;
  setAuthLoading: (loading: boolean) => void;
  setMessage: (message: string) => void;
  errorText: (error: unknown) => string;
  warn?: (message: string, error: unknown) => void;
};

export type AuthSessionLifecycle = {
  ready: Promise<void>;
  stop: () => void;
};

/**
 * Establish the auth listener before restoring the stored session.
 * Invalid stored refresh tokens are cleared locally only; this must not call
 * the hosted logout endpoint or revoke the user's remote session.
 */
export function startAuthSessionLifecycle(
  client: AuthSessionClient,
  handlers: AuthSessionLifecycleHandlers
): AuthSessionLifecycle {
  let active = true;
  const warn = handlers.warn ?? ((message, error) => console.warn(message, error));

  const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
    if (!active) return;
    handlers.setSession(nextSession);
    if (event === "PASSWORD_RECOVERY") handlers.setRecoveryMode(true);
  });

  const ready = (async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (!active) return;

      if (error) {
        const authError = error as { status?: unknown; message?: unknown } | null;
        const status = Number(authError?.status ?? 0);
        const messageText = String(authError?.message ?? handlers.errorText(error));
        const invalidStoredSession =
          status === 400 ||
          status === 401 ||
          /invalid.*refresh|refresh.*(invalid|expired|not found|already used)/i.test(messageText);

        if (invalidStoredSession) {
          // Keep this local: scope "local" clears this device only.
          await client.auth.signOut({ scope: "local" }).catch(() => undefined);
          if (active) {
            handlers.setSession(null);
            handlers.setMessage("Your saved sign-in session has expired. Please sign in again.");
          }
        } else {
          warn("Unable to restore the saved GMS session.", error);
          if (active) handlers.setSession(data.session ?? null);
        }
      } else if (active) {
        handlers.setSession(data.session);
      }
    } catch (error) {
      warn("Session restoration failed.", error);
      if (active) handlers.setSession(null);
    } finally {
      if (active) handlers.setAuthLoading(false);
    }
  })();

  return {
    ready,
    stop() {
      active = false;
      subscription.unsubscribe();
    }
  };
}
