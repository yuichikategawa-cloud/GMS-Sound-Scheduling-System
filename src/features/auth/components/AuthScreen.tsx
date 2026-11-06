import type { FormEvent } from "react";
import "./AuthScreens.css";

export type AuthMode = "login" | "signup" | "reset";

type AuthScreenProps = {
  mode: AuthMode;
  loading: boolean;
  message: string;
  signupCgStatus: string;
  onModeChange: (mode: AuthMode) => void;
  onSignupCgStatusChange: (status: string) => void;
  onClearMessage: () => void;
  onResetSignupCgStatus: () => void;
  onSubmitAuth: (event: FormEvent<HTMLFormElement>) => void;
  onSendPasswordReset: (event: FormEvent<HTMLFormElement>) => void;
};

export default function AuthScreen({
  mode,
  loading,
  message,
  signupCgStatus,
  onModeChange,
  onSignupCgStatusChange,
  onClearMessage,
  onResetSignupCgStatus,
  onSubmitAuth,
  onSendPasswordReset
}: AuthScreenProps) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">GMS SOUND SCHEDULING SYSTEM</p>
        <h1 className={mode === "login" ? "welcome-home-script" : ""}>
          {mode === "login" ? "Welcome Home" : mode === "signup" ? "Create your account" : "Reset your password"}
        </h1>
        <p className="subtle">Serving schedule management for Alam Sutera, BSD and Karawaci.</p>

        {mode === "reset" ? (
          <form onSubmit={onSendPasswordReset} className="stack">
            <label>
              Registered email address
              <input name="recovery_email" type="email" required autoComplete="email" placeholder="you@example.com" />
            </label>
            <button className="btn primary full" disabled={loading}>
              {loading ? <><span className="button-spinner" /> Sending reset link…</> : "Send reset link"}
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => { onModeChange("login"); onClearMessage(); }}
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmitAuth} className="stack auth-registration">
            <label>
              Username
              <input
                name="username"
                required
                minLength={3}
                maxLength={40}
                pattern={"[A-Za-z0-9._\\-]+"}
                autoComplete="username"
                placeholder="Choose a username"
              />
            </label>
            {mode === "signup" && (
              <>
                <label>Full name<input name="full_name" required placeholder="Full name as registered" /></label>
                <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></label>
                <label>
                  Gender
                  <select name="gender" required defaultValue="">
                    <option value="" disabled>Select gender</option>
                    <option>Male</option><option>Female</option><option>Prefer not to say</option>
                  </select>
                </label>
                <label>Date of birth<input name="date_of_birth" type="date" required /></label>
                <label>NIJ – Nomor Induk Jemaat<input name="nij" required placeholder="Your NIJ" /></label>
                <label>Phone number<input name="phone_number" type="tel" required placeholder="e.g. +62812..." /></label>
                <label>
                  Domicile area
                  <select name="domicile_area" required defaultValue="Alam Sutera">
                    <option>Alam Sutera</option><option>BSD</option><option>Karawaci</option><option>Others</option>
                  </select>
                </label>
                <label>Other domicile area (if Others)<input name="domicile_other" placeholder="Specify area" /></label>
                <label>
                  CG category
                  <select name="cg_category" required defaultValue="">
                    <option value="" disabled>Select CG</option>
                    {["AOG Teen", "AOG Youth", "Young Adult", "Family", "Senior"].map(value => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label>
                  CG status
                  <select name="cg_status" required value={signupCgStatus} onChange={event => onSignupCgStatusChange(event.target.value)}>
                    <option value="" disabled>Select status</option>
                    {["Team Leader", "Coach", "CG Leader", "Sponsor", "Member"].map(value => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label>CG number<input name="cg_number" required /></label>
                <fieldset className="days-field">
                  <legend>CG day (select multiple)</legend>
                  <div className="days-options">
                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(day => (
                      <label key={day}><input type="checkbox" name="cg_days" value={day} />{day}</label>
                    ))}
                  </div>
                </fieldset>
                <label>CG time<input name="cg_time" required placeholder="e.g. 19:00" /></label>
                <label className={signupCgStatus === "Team Leader" ? "field-disabled" : ""}>
                  Team Leader name<input name="team_leader_name" disabled={signupCgStatus === "Team Leader"} placeholder="Not required if you are Team Leader" />
                </label>
                <label className={signupCgStatus === "Coach" ? "field-disabled" : ""}>
                  Coach name<input name="coach_name" disabled={signupCgStatus === "Coach"} placeholder="Not required if you are Coach" />
                </label>
                <label className={signupCgStatus === "CG Leader" ? "field-disabled" : ""}>
                  CG Leader name<input name="cg_leader_name" disabled={signupCgStatus === "CG Leader"} placeholder="Not required if you are CG Leader" />
                </label>
                <label>
                  Leader phone number(s)
                  <textarea name="leader_phone_numbers" required placeholder="At least one number; separate multiple numbers with commas" rows={2} />
                </label>
              </>
            )}
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="At least 8 characters"
              />
            </label>
            <button className="btn primary full" disabled={loading}>
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        )}

        {mode === "login" && (
          <button type="button" className="link-btn" onClick={() => { onModeChange("reset"); onClearMessage(); }}>
            Forgot password?
          </button>
        )}
        {mode !== "reset" && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              onModeChange(mode === "login" ? "signup" : "login");
              onResetSignupCgStatus();
              onClearMessage();
            }}
          >
            {mode === "login" ? "Need an account? Sign up" : "Already registered? Sign in"}
          </button>
        )}
        {message && <p className="message">{message}</p>}
      </div>
    </div>
  );
}
