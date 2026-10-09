import { useEffect, useState } from "react";
import { KeyRound, Monitor, RefreshCw } from "lucide-react";
import { api } from "./api";
import { when } from "./org-types";

interface AccountSession {
  id: string;
  organisation: string;
  expiresAt: string;
  current: boolean;
}
export function AccountSecurity({ onSignedOut }: { onSignedOut: () => void }) {
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = () =>
    api<AccountSession[]>("/org/account/sessions").then(setSessions);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function revoke(id?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (id) {
        const result = await api<{ signedOut: boolean }>(
          `/org/account/sessions/${id}`,
          { method: "DELETE" },
        );
        if (result.signedOut) {
          onSignedOut();
          return;
        }
        setNotice("Session signed out.");
      } else {
        const result = await api<{ revoked: number }>(
          "/org/account/sessions/revoke-others",
          { method: "POST" },
        );
        setNotice(
          `${result.revoked} other session${result.revoked === 1 ? "" : "s"} signed out.`,
        );
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (password !== confirm) {
      setError("Your new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/org/account/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: current,
          new_password: password,
        }),
      });
      setCurrent("");
      setPassword("");
      setConfirm("");
      onSignedOut();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your operator account</div>
          <h1>Account security</h1>
          <p>
            Manage your password and active sessions across your organisation
            workspaces.
          </p>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="org-success" role="status">
          {notice}
        </p>
      )}
      <section className="panel org-settings-panel">
        <div className="section-title">
          <div>
            <div className="eyebrow">Control your access</div>
            <h2>
              <Monitor className="icon" /> Active sessions
            </h2>
          </div>
          <button
            className="btn"
            disabled={busy}
            onClick={() => load().catch((e) => setError(e.message))}
          >
            <RefreshCw className="icon" /> Refresh sessions
          </button>
        </div>
        <p className="muted">
          Each sign-in expires after eight hours. No location or device
          fingerprint is collected for this list.
        </p>
        <div className="org-session-list">
          {sessions.map((s) => (
            <article key={s.id} className="org-session-card">
              <div>
                <strong>{s.organisation}</strong>
                {s.current && <span className="pill Low">This session</span>}
                <p className="small muted">Expires {when(s.expiresAt)}</p>
              </div>
              <button
                className="btn"
                disabled={busy || s.current}
                onClick={() => revoke(s.id)}
              >
                Sign out session
              </button>
            </article>
          ))}
        </div>
        <button
          className="btn"
          disabled={busy || sessions.filter((s) => !s.current).length === 0}
          onClick={() => revoke()}
        >
          Sign out all other sessions
        </button>
      </section>
      <section className="panel org-security-panel">
        <div className="eyebrow">Account-owned password change</div>
        <h2>
          <KeyRound className="icon" /> Change password
        </h2>
        <p className="muted">
          Confirm your current password. Changing it signs out every session,
          including this one. Save your new password somewhere safe; email
          recovery is not offered.
        </p>
        <form className="org-form" onSubmit={change}>
          <label>
            Current password
            <input
              aria-label="Current password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            New password
            <input
              aria-label="New password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              aria-label="Confirm new password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? "Changing password…" : "Change password and sign out"}
          </button>
        </form>
      </section>
    </>
  );
}
