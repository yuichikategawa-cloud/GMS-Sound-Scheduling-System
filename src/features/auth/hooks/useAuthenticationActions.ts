import type { Dispatch, FormEvent, SetStateAction } from "react";
import { errorText } from "../../../shared/formatters";
import {
  registerAccount,
  sendPasswordResetLink,
  signInWithUsername,
  updateAccountPassword,
} from "../services/authentication";

type AuthenticationMode = "login" | "signup" | "reset";

type AuthenticationActionsInput = {
  client: typeof import("../../../supabase").supabase;
  mode: AuthenticationMode;
  setMode: Dispatch<SetStateAction<AuthenticationMode>>;
  setAuthLoading: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setRecoveryMode: Dispatch<SetStateAction<boolean>>;
};

/** Owns login, registration, reset-link, and recovered-password form workflows. */
export function useAuthenticationActions({
  client,
  mode,
  setMode,
  setAuthLoading,
  setMessage,
  setRecoveryMode,
}: AuthenticationActionsInput) {
  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setMessage("");
    setAuthLoading(true);
    const formData = new FormData(event.currentTarget);
    try {
      if (mode === "signup") {
        await registerAccount(client, formData);
        setMessage("Registration submitted. Verify your email if confirmation is enabled, then sign in with your username.");
        setMode("login");
      } else {
        await signInWithUsername(
          client,
          String(formData.get("username")),
          String(formData.get("password")),
        );
      }
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setAuthLoading(false);
    }
  }

  async function sendPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setAuthLoading(true);
    setMessage("");
    const formData = new FormData(event.currentTarget);
    const recoveryEmail = String(formData.get("recovery_email") || "").trim();
    try {
      await sendPasswordResetLink(client, recoveryEmail, `${window.location.origin}/`);
      setMessage("If an account exists for that email, a password reset link has been sent. Please check your inbox.");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setAuthLoading(false);
    }
  }

  async function updateRecoveredPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const formData = new FormData(event.currentTarget);
    const nextPassword = String(formData.get("new_password") || "");
    setAuthLoading(true);
    setMessage("");
    try {
      await updateAccountPassword(client, nextPassword);
      setRecoveryMode(false);
      setMessage("Password updated. You can now continue using your new password.");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setAuthLoading(false);
    }
  }

  return { submitAuth, sendPasswordReset, updateRecoveredPassword };
}
