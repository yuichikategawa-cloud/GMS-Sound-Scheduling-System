import type { FormEvent } from "react";
import "./AuthScreens.css";

type PasswordRecoveryScreenProps = {
  loading: boolean;
  message: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export default function PasswordRecoveryScreen({
  loading,
  message,
  onSubmit
}: PasswordRecoveryScreenProps) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">GMS SOUND SCHEDULING SYSTEM</p>
        <h1>Set a new password</h1>
        <p className="subtle">Choose a new password for your account.</p>
        <form onSubmit={onSubmit} className="stack">
          <label>
            New password
            <input name="new_password" type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
          </label>
          <button className="btn primary full" disabled={loading}>
            {loading ? <><span className="button-spinner" /> Updating password…</> : "Update password"}
          </button>
        </form>
        {message && <p className="message">{message}</p>}
      </div>
    </div>
  );
}
