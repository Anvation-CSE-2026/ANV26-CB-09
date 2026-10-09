import { useCallback, useEffect, useState } from "react";
import {
  Search,
  Building2,
  Users,
  Cable,
  FolderInput,
  LayoutGrid,
  LogOut,
  Monitor,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError } from "./api";
import type { OrgUser, OrgCase } from "./org-types";
import { OrganisationCases } from "./OrganisationCases";
import { OrganisationSettings } from "./OrganisationSettings";
import { OrganisationValidation } from "./OrganisationValidation";
import { AccountSecurity } from "./AccountSecurity";
import { HostedActivity } from "./HostedActivity";
import "./organisation.css";

function AccountGate({
  onAuthenticated,
  onShowcase,
}: {
  onAuthenticated: () => void;
  onShowcase: () => void;
}) {
  const invite = new URLSearchParams(location.search).get("invite") || "";
  const [mode, setMode] = useState<"login" | "register" | "join">(
    invite ? "join" : "register",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [invitation, setInvitation] = useState(invite);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/org/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          ...(mode === "register"
            ? { display_name: displayName, organisation_name: organisation }
            : {}),
          ...(mode === "join"
            ? { display_name: displayName, token: invitation }
            : {}),
        }),
      });
      history.replaceState({}, "", "/");
      onAuthenticated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="org-entry">
      <section className="org-entry-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Search className="icon" />
          </span>
          Identity Lens
        </a>
        <div className="org-story-content">
          <div className="eyebrow">Evidence-led identity investigation</div>
          <h1>A workspace your organisation can make its own.</h1>
          <p>
            Connect registration evidence. Understand shared relationships. Give
            every assessment a review trail.
          </p>
          <div className="org-story-steps">
            <span>
              01 <strong>Connect your evidence</strong>
            </span>
            <span>
              02 <strong>Investigate the signals</strong>
            </span>
            <span>
              03 <strong>Document the decision</strong>
            </span>
          </div>
        </div>
        <p className="small">
          CY-04 submission: synthetic applicant datasets. Named operator
          accounts and persistent organisation workspaces.
        </p>
      </section>
      <section className="org-entry-form">
        <div className="eyebrow">Your organisation workspace</div>
        <h2>
          {mode === "register"
            ? "Start with your organisation"
            : mode === "join"
              ? "Join your team"
              : "Welcome back"}
        </h2>
        <p className="muted">
          {mode === "register"
            ? "Create an administrator account. Your workspace starts empty and belongs to your team."
            : mode === "join"
              ? "Accept a single-use invitation. Use your existing account credentials or create a new account."
              : "Sign in to access your organisation’s cases and integrations."}
        </p>
        <div className="org-tabs" role="tablist" aria-label="Account options">
          {(["register", "login", "join"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={mode === v}
              onClick={() => {
                setMode(v);
                setError("");
              }}
            >
              {v === "register"
                ? "Create workspace"
                : v === "login"
                  ? "Sign in"
                  : "Join team"}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="org-form">
          {mode === "register" && (
            <label>
              Organisation name
              <input
                required
                minLength={2}
                maxLength={100}
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Your organisation"
              />
            </label>
          )}
          {mode !== "login" && (
            <label>
              Your display name
              <input
                required
                minLength={2}
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Username
            <input
              required
              minLength={3}
              maxLength={60}
              pattern={"[a-zA-Z0-9._\\-]+"}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              aria-label="Password"
              aria-describedby="password-help"
              type="password"
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
            <span id="password-help" className="small muted">
              At least 12 characters. Passwords are stored as memory-hard
              hashes.
            </span>
          </label>
          {mode === "join" && (
            <label>
              Invitation token
              <input
                required
                value={invitation}
                onChange={(e) => setInvitation(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <button className="btn primary w-full" disabled={busy}>
            {busy
              ? "Opening workspace…"
              : mode === "register"
                ? "Create organisation"
                : mode === "join"
                  ? "Accept invitation"
                  : "Sign in"}
          </button>
        </form>
        <div className="org-entry-footer">
          <ShieldCheck className="icon" />
          <span>Applicant evidence stays separate between organisations.</span>
        </div>
        <button className="text-link" onClick={onShowcase}>
          Explore sample cases
        </button>
      </section>
    </main>
  );
}

type Page =
  | "cases"
  | "imports"
  | "integrations"
  | "team"
  | "audit"
  | "validation"
  | "security"
  | "hosted";
const pages: [Page, string, typeof Search][] = [
  ["cases", "Investigations", LayoutGrid],
  ["hosted", "Hosted activity", Monitor],
  ["imports", "Import evidence", FolderInput],
  ["integrations", "Connections", Cable],
  ["team", "Your team", Users],
  ["audit", "Activity trail", ShieldCheck],
  ["validation", "Method & validation", ShieldCheck],
  ["security", "Account security", ShieldCheck],
];

export function OrganisationApp({ onShowcase }: { onShowcase: () => void }) {
  const [user, setUser] = useState<OrgUser | null>(null),
    [cases, setCases] = useState<OrgCase[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [page, setPage] = useState<Page>("cases"),
    [presentation, setPresentation] = useState(false);
  const [workspaces, setWorkspaces] = useState<
    { id: string; name: string; role: string }[]
  >([]);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const [rows, memberships] = await Promise.all([
      api<OrgCase[]>("/org/cases"),
      api<{ id: string; name: string; role: string }[]>("/org/workspaces"),
    ]);
    setCases(rows);
    setWorkspaces(memberships);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const account = await api<OrgUser>("/org/me");
      setUser(account);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [refresh]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    document.body.classList.toggle("presentation", presentation);
    document.documentElement.classList.toggle("projector", presentation);
    return () => {
      document.body.classList.remove("presentation");
      document.documentElement.classList.remove("projector");
    };
  }, [presentation]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function logout() {
    try {
      await api("/org/logout", { method: "POST" });
      setUser(null);
      setCases([]);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  if (loading)
    return (
      <main className="loading-screen">
        <Search className="icon" />
        <p role="status">Opening your workspace…</p>
      </main>
    );
  if (error)
    return (
      <main className="error-page">
        <h1>Unable to open the workspace</h1>
        <p role="alert">{error}</p>
        <button className="btn primary" onClick={load}>
          Try again
        </button>
      </main>
    );
  if (!user)
    return <AccountGate onAuthenticated={load} onShowcase={onShowcase} />;
  const visiblePages = pages.filter(
    ([key]) => key !== "integrations" || user.role === "admin",
  );
  return (
    <div className="shell org-shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Search className="icon" />
          </span>
          Identity Lens
        </a>
        <div className="org-workspace-name">
          <Building2 className="icon" />
          <span>{user.organisationName}</span>
        </div>
        <nav className="nav" aria-label="Organisation navigation">
          {visiblePages.map(([key, label, Icon]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              aria-current={page === key ? "page" : undefined}
              onClick={() => setPage(key)}
            >
              <Icon className="icon" />
              {label}
            </button>
          ))}
          <button onClick={onShowcase}>
            <Monitor className="icon" />
            Sample cases
          </button>
        </nav>
        <div className="rail-bottom">
          <div className="rail-rule" />
          <span className="eyebrow">Workspace access</span>
          <p>
            <strong>{user.name}</strong>
            <br />
            {user.role} · {user.username}
          </p>
          <p className="small">
            Fictional applicant identities. Hosted summaries are measured and
            client-reported. Human review remains responsible for conclusions.
          </p>
        </div>
      </aside>
      <div>
        <header className="topbar">
          <div className="breadcrumb">
            <span>{user.organisationName}</span>
            <span>/</span>
            <span>{pages.find(([key]) => key === page)?.[1]}</span>
          </div>
          <div className="header-actions">
            {workspaces.length > 1 && (
              <select
                aria-label="Switch organisation"
                value={user.organisationId}
                onChange={async (e) => {
                  try {
                    await api("/org/switch", {
                      method: "POST",
                      body: JSON.stringify({ organisation_id: e.target.value }),
                    });
                    await load();
                  } catch (e) {
                    setNotice((e as Error).message);
                  }
                }}
              >
                {workspaces.map((w) => (
                  <option value={w.id} key={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn subtle"
              onClick={() => setPresentation(!presentation)}
            >
              <Monitor className="icon" />
              {presentation ? "Exit presentation" : "Presentation mode"}
            </button>
            <button
              className="btn subtle"
              aria-label="Sign out"
              onClick={logout}
            >
              <LogOut className="icon" />
            </button>
          </div>
        </header>
        <div
          className="org-mobile-context"
          role="region"
          aria-label="Current organisation"
        >
          <Building2 className="icon" />
          <strong>{user.organisationName}</strong>
          <span>
            {user.username} · {user.role}
          </span>
        </div>
        <nav className="org-mobile-nav" aria-label="Workspace pages">
          {visiblePages.map(([key, label]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => setPage(key)}
            >
              {label}
            </button>
          ))}
          <button onClick={onShowcase}>Sample cases</button>
        </nav>
        <main className="content" id="main">
          {page === "cases" ? (
            <OrganisationCases
              key={user.organisationId}
              cases={cases}
              user={user}
              refresh={refresh}
              notify={setNotice}
              onNavigate={setPage}
            />
          ) : page === "validation" ? (
            <OrganisationValidation key={user.organisationId} />
          ) : page === "security" ? (
            <AccountSecurity
              key={user.id}
              onSignedOut={() => {
                setPage("cases");
                load();
              }}
            />
          ) : page === "hosted" ? (
            <HostedActivity
              key={user.organisationId}
              cases={cases}
              user={user}
              refresh={refresh}
              onInvestigations={() => setPage("cases")}
            />
          ) : (
            <OrganisationSettings
              key={`${user.organisationId}:${page}`}
              page={page}
              user={user}
              refresh={refresh}
              notify={setNotice}
            />
          )}
        </main>
        {notice && (
          <div className="toast" role="status">
            {notice}
          </div>
        )}
      </div>
    </div>
  );
}
