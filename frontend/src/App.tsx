import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  LayoutGrid,
  GitCompareArrows,
  ShieldCheck,
  Download,
  Monitor,
  Users,
  ChevronLeft,
  ChevronRight,
  FileText,
  Check,
  TriangleAlert,
  LogOut,
  Building2,
} from "lucide-react";
import type {
  Assessment,
  Band,
  Bootstrap,
  Identity,
  Review,
  User,
  View,
} from "./types";
import { api, download, ApiError } from "./api";
import { ReviewPanel } from "./ReviewPanel";
import { Method } from "./Method";
import { registerWorkspaceTools } from "./webmcp";
import { IntakeDialog } from "./IntakeDialog";
const Graph = lazy(() => import("./Graph").then((m) => ({ default: m.Graph })));
const date = (t: string) =>
  new Date(t).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const timestamp = (t: string) =>
  new Date(t).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
export function Pill({ band }: { band: Band }) {
  return (
    <span className={`pill ${band}`}>
      <span className="dot" />
      {band === "High"
        ? "High risk"
        : band === "Low"
          ? "Low risk"
          : "Needs review"}
    </span>
  );
}
export function Breakdown({ result }: { result: Assessment }) {
  return (
    <div className="breakdown">
      {result.groups.map((g) => (
        <div className="break-row" key={g.key}>
          <span>{g.label}</span>
          <div
            className="track"
            aria-label={`${g.label}: ${g.score} of ${g.cap} points`}
          >
            <span style={{ width: `${(100 * g.score) / g.cap}%` }} />
          </div>
          <span className="break-value">
            {g.score}
            <span className="muted">/{g.cap}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Login({
  onLogin,
  onOrganisation,
  readOnly,
}: {
  onLogin: () => void;
  onOrganisation: () => void;
  readOnly: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(role = "analyst") {
    setBusy(true);
    setError("");
    try {
      await api("/auth/sample", {
        method: "POST",
        body: JSON.stringify({ role: readOnly ? "viewer" : role }),
      });
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand">
          <span className="brand-mark">
            <Search className="icon" />
          </span>
          Identity Lens
        </div>
        <div className="eyebrow">CY-04 · Analyst workspace</div>
        <h1>Evidence before conclusions.</h1>
        <p className="muted">
          Investigate identity signals, follow shared relationships and document
          your review.
        </p>
        {
          <>
            <div className="login-scope">
              <ShieldCheck size={21} />
              <p>
                Sample evidence workspace. All profiles, devices and activity
                are synthetic.
                {readOnly && " Public sample cases have read-only access."}
              </p>
            </div>
            <button
              className="btn primary w-full"
              disabled={busy}
              onClick={() => login()}
            >
              {busy ? "Opening workspace…" : "Open sample cases"}
            </button>
            {!readOnly && (
              <button
                className="btn w-full mt-3"
                disabled={busy}
                onClick={() => login("viewer")}
              >
                Explore with read-only access
              </button>
            )}
          </>
        }
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <p className="login-foot">Human review only · No automatic denial</p>
        <button className="text-link" onClick={onOrganisation}>
          <Building2 className="icon" /> Organisation workspace
        </button>
      </section>
    </main>
  );
}

export function App({ onOrganisation }: { onOrganisation: () => void }) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [sampleReadOnly, setSampleReadOnly] = useState(false);
  const [data, setData] = useState<Bootstrap | null>(null),
    [loading, setLoading] = useState(true),
    [authRequired, setAuthRequired] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("workspace"),
    [selected, setSelected] = useState("CASE-003"),
    [tab, setTab] = useState("evidence"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("risk"),
    [page, setPage] = useState(0),
    [presentation, setPresentation] = useState(false);
  const results = useMemo(
    () => new Map(data?.assessments.map((r) => [r.id, r]) || []),
    [data],
  );
  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    document.body.classList.toggle("presentation", presentation);
    document.documentElement.classList.toggle("projector", presentation);
    return () => {
      document.body.classList.remove("presentation");
      document.documentElement.classList.remove("projector");
    };
  }, [presentation]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const config = await api<{
        mode: string;
        user: User | null;
        publicSampleReadOnly?: boolean;
      }>("/auth/config");
      setSampleReadOnly(Boolean(config.publicSampleReadOnly));
      if (!config.user) {
        setAuthRequired(true);
        setData(null);
        return;
      }
      const b = await api<Bootstrap>("/bootstrap");
      setData(b);
      setAuthRequired(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setAuthRequired(true);
        setData(null);
      } else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const inspect = useCallback((id: string) => {
    setSelected(id);
    setView("workspace");
    setTab("evidence");
  }, []);
  const saveReview = useCallback((r: Review) => {
    setData((old) =>
      old
        ? {
            ...old,
            reviews: {
              ...old.reviews,
              [r.identityId]: { status: r.status, revision: r.revision },
            },
          }
        : old,
    );
  }, []);
  useEffect(() => {
    if (data) return registerWorkspaceTools(results, inspect);
  }, [data, results, inspect]);
  async function exportCase(id: string) {
    try {
      download(`${id}-assessment.json`, await api(`/cases/${id}/report`));
      notify("Assessment report downloaded.");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setData(null);
      setAuthRequired(true);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (loading)
    return (
      <main className="loading-screen">
        <div className="brand">
          <Search className="icon" />
          Identity Lens
        </div>
        <p role="status">Loading the investigation workspace…</p>
      </main>
    );
  if (error)
    return (
      <main className="error-page">
        <h1>Unable to open the workspace.</h1>
        <p>{error}</p>
        <button className="btn primary mt-4" onClick={load}>
          Try again
        </button>
      </main>
    );
  if (authRequired || !data)
    return (
      <Login
        onLogin={load}
        onOrganisation={onOrganisation}
        readOnly={sampleReadOnly}
      />
    );
  const p = data.population.find((p) => p.id === selected)!,
    r = results.get(selected)!;
  const navItems: [View, string, typeof Search][] = [
    ["workspace", "Assessment workspace", LayoutGrid],
    ["compare", "Compare three cases", GitCompareArrows],
    ["method", "Method & validation", ShieldCheck],
  ];
  const nav = () =>
    navItems.map(([key, label, Icon]) => (
      <button
        key={key}
        onClick={() => setView(key)}
        className={view === key ? "active" : ""}
        aria-current={view === key ? "page" : undefined}
      >
        <Icon className="icon" />
        {label}
      </button>
    ));
  let cases = data.population.filter(
    (p) =>
      (filter === "all" || results.get(p.id)!.band === filter) &&
      (!query.trim() ||
        `${p.id} ${p.displayName}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  cases.sort(
    sort === "risk"
      ? (a, b) =>
          results.get(b.id)!.score - results.get(a.id)!.score ||
          a.id.localeCompare(b.id)
      : sort === "id"
        ? (a, b) => a.id.localeCompare(b.id)
        : (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const pages = Math.max(1, Math.ceil(cases.length / 12)),
    currentPage = Math.min(page, pages - 1);
  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">
              <Search className="icon" />
            </span>
            Identity Lens
          </div>
          <div className="eyebrow">Sample cases</div>
          <nav className="nav" aria-label="Main navigation">
            {nav()}
            <button onClick={onOrganisation}>
              <Building2 className="icon" /> Organisation workspace
            </button>
          </nav>
          <div className="rail-bottom">
            <div className="rail-rule" />
            <div className="scope-label">
              <ShieldCheck className="icon" />
              Synthetic environment
            </div>
            <p>
              All identities and activity are fictional. Assessments support
              human review.
            </p>
            <p>CY-04 · Policy v{data.modelVersion}</p>
          </div>
        </aside>
        <div>
          <header className="topbar">
            <div className="breadcrumb">
              <span>Sample cases</span>
              <span>/</span>
              <span>{navItems.find((i) => i[0] === view)![1]}</span>
            </div>
            <nav className="mobile-nav" aria-label="Mobile navigation">
              {nav()}
            </nav>
            <nav
              className="presentation-nav"
              aria-label="Presentation navigation"
            >
              {nav()}
            </nav>
            <div className="header-actions">
              <button className="btn subtle" onClick={onOrganisation}>
                <Building2 className="icon" /> Organisation workspace
              </button>
              <span className="pill">SYNTHETIC DATA</span>
              <button
                className="btn subtle"
                aria-pressed={presentation}
                onClick={() => setPresentation(!presentation)}
              >
                <Monitor className="icon" />
                {presentation ? "Exit presentation" : "Presentation mode"}
              </button>
              <button
                className="btn subtle"
                aria-label="Sign out"
                title={`Sample workspace · ${data.user.role}`}
                onClick={logout}
              >
                <LogOut className="icon" />
              </button>
            </div>
          </header>
          <main className="content" id="main">
            {view === "workspace" ? (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">Identity risk assessment</div>
                    <h1>A clearer picture of identity risk.</h1>
                    <p>
                      Explore the signals. Follow the connections. Understand
                      the score.
                    </p>
                  </div>
                  <div className="heading-actions">
                    <button
                      className="btn"
                      disabled={data.user.role === "viewer"}
                      onClick={() => setIntakeOpen(true)}
                    >
                      Add synthetic case
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        download("identity-lens-synthetic-dataset.json", {
                          syntheticOnly: true,
                          seed: data.seed,
                          asOf: data.asOf,
                          population: data.population,
                        })
                      }
                    >
                      <Download className="icon" />
                      Export dataset
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => setView("compare")}
                    >
                      <GitCompareArrows className="icon" />
                      Compare sample cases
                    </button>
                  </div>
                </div>
                <div className="stats">
                  <div className="stat">
                    <div className="stat-label">Identities assessed</div>
                    <Users className="stat-icon icon" />
                    <div className="stat-value mono">{results.size}</div>
                    <div className="stat-note">
                      Reproducible synthetic population
                    </div>
                  </div>
                  {(["High", "Review", "Low"] as Band[]).map((b) => (
                    <div className={`stat ${b.toLowerCase()}`} key={b}>
                      <div className="stat-label">
                        {b === "High"
                          ? "High risk"
                          : b === "Review"
                            ? "Needs review"
                            : "Low risk"}
                      </div>
                      <div className="stat-value mono">
                        {
                          [...results.values()].filter((r) => r.band === b)
                            .length
                        }
                      </div>
                      <div className="stat-note">
                        {b === "High"
                          ? "60–100 · Prioritise investigation"
                          : b === "Review"
                            ? "25–59 · Examine mixed evidence"
                            : "0–24 · Limited warning signals"}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="workspace">
                  <section className="panel queue" aria-label="Identity queue">
                    <div className="panel-heading">
                      <div>
                        <h2>Identity queue</h2>
                        <p>Select a case to inspect its evidence.</p>
                      </div>
                      <Users className="icon" />
                    </div>
                    <div className="queue-controls">
                      <div className="search">
                        <Search className="icon" />
                        <input
                          type="search"
                          aria-label="Search by identity ID or name"
                          placeholder="Search identity or ID…"
                          value={query}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            setPage(0);
                          }}
                        />
                      </div>
                      <div className="queue-selects">
                        <select
                          aria-label="Filter by risk band"
                          value={filter}
                          onChange={(e) => {
                            setFilter(e.target.value);
                            setPage(0);
                          }}
                        >
                          {[
                            ["all", "All risk levels"],
                            ["High", "High risk"],
                            ["Review", "Needs review"],
                            ["Low", "Low risk"],
                          ].map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Sort identities"
                          value={sort}
                          onChange={(e) => {
                            setSort(e.target.value);
                            setPage(0);
                          }}
                        >
                          <option value="risk">Highest risk first</option>
                          <option value="id">Identity ID</option>
                          <option value="recent">Newest registration</option>
                        </select>
                      </div>
                    </div>
                    <div className="queue-list">
                      {cases
                        .slice(currentPage * 12, (currentPage + 1) * 12)
                        .map((p) => {
                          const r = results.get(p.id)!;
                          return (
                            <button
                              className={`case-row ${selected === p.id ? "selected" : ""}`}
                              key={p.id}
                              onClick={() => inspect(p.id)}
                              aria-pressed={selected === p.id}
                            >
                              <div className="row-top">
                                <span>
                                  <span className="case-name">
                                    {p.displayName}
                                  </span>
                                  <br />
                                  <span className="case-id">
                                    {p.id}
                                    {data.showcases.includes(p.id)
                                      ? " · Sample case"
                                      : ""}
                                  </span>
                                </span>
                                <span className="row-score mono">
                                  {r.score}
                                </span>
                              </div>
                              <div className="row-bottom">
                                <Pill band={r.band} />
                                <span className="case-reason">
                                  {r.indicators[0]?.title ||
                                    "Consistent observations"}
                                </span>
                              </div>
                              {data.reviews[p.id]?.status !== "Unreviewed" && (
                                <div className="queue-review-status">
                                  {data.reviews[p.id]?.status}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      {!cases.length && (
                        <div className="empty">
                          No identities match these filters.
                        </div>
                      )}
                    </div>
                    <div className="queue-footer">
                      <span>
                        {cases.length} cases · Page {currentPage + 1} / {pages}
                      </span>
                      <span>
                        <button
                          aria-label="Previous page"
                          disabled={!currentPage}
                          onClick={() => setPage(currentPage - 1)}
                        >
                          <ChevronLeft className="icon" />
                        </button>
                        <button
                          aria-label="Next page"
                          disabled={currentPage === pages - 1}
                          onClick={() => setPage(currentPage + 1)}
                        >
                          <ChevronRight className="icon" />
                        </button>
                      </span>
                    </div>
                  </section>
                  <section
                    className="panel"
                    aria-label="Selected identity assessment"
                  >
                    <div className="detail-top">
                      <div className="case-heading">
                        <div>
                          <div className="eyebrow">
                            {p.id}
                            {data.showcases.includes(p.id)
                              ? " / SAMPLE CASE"
                              : ""}
                          </div>
                          <h2>{p.displayName}</h2>
                          <div className="case-meta">
                            <span>Registered {date(p.createdAt)}</span>
                            <span>·</span>
                            <span>{p.events.length} sessions</span>
                            <span>·</span>
                            <span>{p.declaredRegion} region</span>
                          </div>
                        </div>
                        <button
                          className="btn"
                          onClick={() => exportCase(p.id)}
                          aria-label={`Export assessment for ${p.id}`}
                        >
                          <Download className="icon" />
                          Report
                        </button>
                      </div>
                      <div className="risk-area">
                        <div className="risk-value">
                          <div className={`risk-number mono ${r.band}`}>
                            {r.score}
                          </div>
                          <div className="score-caption">
                            Fraud-risk score <strong>/ 100</strong>
                          </div>
                          <div className="score-scale" aria-hidden="true">
                            {Array.from({ length: 10 }, (_, i) => (
                              <span
                                key={i}
                                className={
                                  i < Math.ceil(r.score / 10)
                                    ? `on ${r.band}`
                                    : ""
                                }
                              />
                            ))}
                          </div>
                        </div>
                        <Breakdown result={r} />
                      </div>
                      <div className="mb-4">
                        <Pill band={r.band} />
                        <span className="small muted ml-2">
                          {r.band === "High"
                            ? "Prioritise manual investigation"
                            : r.band === "Review"
                              ? "Additional evidence needed"
                              : "Limited observed risk"}
                        </span>
                      </div>
                      <div className="explanation">
                        <div className="label">
                          <FileText className="icon" />
                          Analyst explanation
                        </div>
                        {r.explanation}
                      </div>
                    </div>
                    <div
                      className="tabs"
                      role="tablist"
                      aria-label="Case evidence views"
                    >
                      {[
                        ["evidence", "Risk indicators", r.indicators.length],
                        ["network", "Relationships", r.links.length],
                        ["activity", "Profile & activity", p.events.length],
                      ].map(([key, label, n], index) => (
                        <button
                          key={key}
                          role="tab"
                          id={`tab-${key}`}
                          aria-selected={tab === key}
                          aria-controls="case-tab-panel"
                          tabIndex={tab === key ? 0 : -1}
                          className={`tab ${tab === key ? "active" : ""}`}
                          onClick={() => setTab(String(key))}
                          onKeyDown={(e) => {
                            const keys = ["evidence", "network", "activity"];
                            if (
                              [
                                "ArrowRight",
                                "ArrowLeft",
                                "Home",
                                "End",
                              ].includes(e.key)
                            ) {
                              e.preventDefault();
                              const next =
                                e.key === "Home"
                                  ? 0
                                  : e.key === "End"
                                    ? 2
                                    : (index +
                                        (e.key === "ArrowRight" ? 1 : 2)) %
                                      3;
                              setTab(keys[next]);
                              requestAnimationFrame(() =>
                                document
                                  .getElementById(`tab-${keys[next]}`)
                                  ?.focus(),
                              );
                            }
                          }}
                        >
                          {label}
                          <span className="tab-count">{n}</span>
                        </button>
                      ))}
                    </div>
                    <div
                      className="detail-body"
                      role="tabpanel"
                      id="case-tab-panel"
                      aria-labelledby={`tab-${tab}`}
                    >
                      {tab === "evidence" ? (
                        <Evidence key={`evidence-${p.id}`} p={p} result={r} />
                      ) : tab === "network" ? (
                        <Graph
                          result={r}
                          results={results}
                          onSelect={inspect}
                        />
                      ) : (
                        <Activity p={p} result={r} />
                      )}
                      <ReviewPanel
                        key={`review-${p.id}`}
                        id={p.id}
                        user={data.user}
                        onSaved={saveReview}
                      />
                    </div>
                  </section>
                </div>
                <div className="footer-note">
                  <span>
                    Advisory scores · No automatic denial · No real personal
                    identity data
                  </span>
                  <span>
                    Dataset seed {data.seed} · Snapshot {date(data.asOf)}
                  </span>
                </div>
              </>
            ) : view === "compare" ? (
              <Comparison
                data={data}
                results={results}
                onSelect={inspect}
                onExport={async () => {
                  try {
                    download(
                      "identity-lens-three-case-comparison.json",
                      await Promise.all(
                        data.showcases.map((id) => api(`/cases/${id}/report`)),
                      ),
                    );
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              />
            ) : (
              <Method data={data} />
            )}
          </main>
        </div>
      </div>
      {intakeOpen && (
        <IntakeDialog
          population={data.population}
          onClose={() => setIntakeOpen(false)}
          onCreated={async (id) => {
            setSelected(id);
            setTab("evidence");
            setView("workspace");
            setIntakeOpen(false);
            await load();
            notify("Synthetic case saved and assessed.");
          }}
        />
      )}
      {notice && (
        <div className="notice show" role="status">
          {notice}
        </div>
      )}
    </>
  );
}

function Evidence({ p, result: r }: { p: Identity; result: Assessment }) {
  const [excluded, setExcluded] = useState<string[]>([]),
    [sim, setSim] = useState(r),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  async function omit(id: string, checked: boolean) {
    const next = checked ? [...excluded, id] : excluded.filter((x) => x !== id);
    setExcluded(next);
    const seq = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const s = await api<Assessment>(`/cases/${p.id}/sensitivity`, {
        method: "POST",
        body: JSON.stringify({ excluded: next }),
      });
      if (seq === generation.current) setSim(s);
    } catch (e) {
      if (seq === generation.current) setError((e as Error).message);
    } finally {
      if (seq === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="section-title">
        <h3>Contributing indicators</h3>
        <span>{r.indicators.length} triggered · Group caps applied</span>
      </div>
      {r.indicators.length ? (
        [...r.indicators]
          .sort((a, b) => b.points - a.points)
          .map((i) => (
            <div className="signal" key={i.id}>
              <span className="signal-symbol">
                <TriangleAlert className="icon" />
              </span>
              <div>
                <div className="signal-title">{i.title}</div>
                <div className="observed">{i.observed}</div>
                <p>{i.reason}</p>
                <details>
                  <summary>Interpretation & context</summary>
                  <p>{i.context}</p>
                  <p>
                    Category: {r.groups.find((g) => g.key === i.group)?.label}.
                    Raw weight: {i.points} points; contribution is subject to
                    the category cap.
                  </p>
                </details>
              </div>
              <span className="points mono">+{i.points}</span>
            </div>
          ))
      ) : (
        <div className="empty text-left">
          No configured risk indicators were triggered by these observations.
        </div>
      )}
      <div className="mitigation-block">
        <div className="section-title">
          <h3>
            <Check className="icon" /> Evidence that moderates concern
          </h3>
        </div>
        {r.mitigations.map((m) => (
          <div className="mitigation" key={m.title}>
            <Check className="icon" />
            <div>
              <strong>{m.title}</strong>
              <p>{m.evidence}</p>
            </div>
          </div>
        ))}
        <p className="small muted mt-4">
          These observations provide context. They do not subtract points or
          establish authenticity.
        </p>
      </div>
      {r.indicators.length > 0 && (
        <div className="sim-panel">
          <h3>What changes if an indicator is removed?</h3>
          <p>
            Recalculate with selected indicators omitted. This tests scoring
            sensitivity; it does not prove causation.
          </p>
          {r.indicators.map((i) => (
            <label className="sim-choice" key={i.id}>
              <input
                type="checkbox"
                checked={excluded.includes(i.id)}
                onChange={(e) => omit(i.id, e.target.checked)}
              />
              <span>Omit {i.title.toLowerCase()}</span>
            </label>
          ))}
          {error ? (
            <p role="alert" className="inline-error">
              {error}
            </p>
          ) : (
            <div className="sim-result" aria-live="polite">
              <span>
                Original <strong>{r.score}</strong> → Simulated{" "}
                <strong>{busy ? "…" : sim.score}</strong>
                <br />
                <span className="small muted">
                  {busy
                    ? "Recalculating…"
                    : `${r.score - sim.score} points lower · Original case stays unchanged`}
                </span>
              </span>
              <Pill band={sim.band} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Activity({ p, result: r }: { p: Identity; result: Assessment }) {
  const fields = [
    ["Identity ID", p.id],
    ["Declared region", p.declaredRegion],
    [
      "Email history at registration",
      `${Math.floor((Date.parse(p.createdAt) - Date.parse(p.emailCreatedAt)) / 86400000)} days`,
    ],
    ["Contact verification", p.phoneVerified ? "Completed" : "Incomplete"],
    ["Address token", p.addressToken],
    ["Recovery phone token", p.phoneToken],
    ["Device environment", p.emulatedDevice ? "Emulated" : "Standard"],
    ["Reported device platform", p.deviceAttributes.reportedPlatform],
    ["Browser-reported platform", p.deviceAttributes.browserPlatform],
    ["Mean form completion", `${Math.round(r.summary.formSeconds)} seconds`],
  ];
  return (
    <>
      <div className="section-title">
        <h3>Synthetic profile</h3>
        <span>All times shown in UTC</span>
      </div>
      <dl className="profile-grid">
        {fields.map(([key, value]) => (
          <div className="profile-item" key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="section-title">
        <h3>Profile consistency evidence</h3>
      </div>
      <p className="small muted">
        The engine compares these supplied records directly.
      </p>
      <table className="rule-table mb-6">
        <thead>
          <tr>
            <th scope="col">Synthetic record</th>
            <th scope="col">Birth year</th>
            <th scope="col">Declared region</th>
          </tr>
        </thead>
        <tbody>
          {p.profileRecords.map((record) => (
            <tr key={record.source}>
              <td>{record.source}</td>
              <td>{record.birthYear}</td>
              <td>{record.declaredRegion}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section-title">
        <h3>Behavioural profile & activity</h3>
        <span>{p.events.length + 1} events</span>
      </div>
      <div className="timeline">
        <div className="event">
          <div className="event-time">{timestamp(p.createdAt)} UTC</div>
          <strong>Identity registered</strong>
          <p>
            Declared region: {p.declaredRegion} ·{" "}
            {p.phoneVerified
              ? "Contact verified"
              : "Contact verification incomplete"}
          </p>
        </div>
        {p.events.map((e, i) => (
          <div className="event" key={e.id}>
            <div className="event-time">{timestamp(e.timestamp)} UTC</div>
            <strong>
              Session {i + 1} · {e.deviceId}
            </strong>
            <p>
              {e.region} region · {e.ipToken}
              <br />
              {Math.round(e.formSeconds)}s form completion · {e.editCount} field
              edits · {e.failedAttempts} failed sign-ins
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

function Comparison({
  data,
  results,
  onSelect,
  onExport,
}: {
  data: Bootstrap;
  results: Map<string, Assessment>;
  onSelect: (id: string) => void;
  onExport: () => void;
}) {
  const notes = [
    "Consistent profile and contact details, a coherent device, and ordinary completion behaviour produce limited observed risk.",
    "A shared device and contact, new email and unusual form behaviour raise concern. Consistent profile details and no registration burst leave a plausible benign explanation.",
    "Rapid registrations share a device, address and contact. Profile conflicts and anomalous behaviour corroborate the network evidence.",
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Case comparison</div>
          <h1>Three identities. Three different stories.</h1>
          <p>
            The same method applied to legitimate, ambiguous and suspicious
            scenarios.
          </p>
        </div>
        <button className="btn" onClick={onExport}>
          <Download className="icon" />
          Export comparison
        </button>
      </div>
      <div className="comparison-grid">
        {data.showcases.map((id, i) => {
          const p = data.population.find((p) => p.id === id)!,
            r = results.get(id)!;
          return (
            <article className="panel compare-card" key={id}>
              <div className="eyebrow">
                {
                  [
                    "01 / Legitimate scenario",
                    "02 / Ambiguous scenario",
                    "03 / Suspicious scenario",
                  ][i]
                }
              </div>
              <h2>{p.displayName}</h2>
              <div className="small muted mt-2">
                {id} · {p.events.length} observed sessions
              </div>
              <div className="compare-score">
                <div>
                  <span className={`risk-number ${r.band}`}>{r.score}</span>
                  <span className="small muted"> / 100</span>
                </div>
                <Pill band={r.band} />
              </div>
              <p className="compare-note">{notes[i]}</p>
              <Breakdown result={r} />
              <div className="compare-section">
                <h3>Primary evidence</h3>
                <ul>
                  {(r.indicators.length
                    ? [...r.indicators]
                        .sort((a, b) => b.points - a.points)
                        .slice(0, 4)
                        .map((s) => `${s.title}: ${s.observed}`)
                    : r.mitigations.slice(0, 4).map((s) => s.title)
                  ).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div className="compare-section">
                <h3>Analyst interpretation</h3>
                <p className="small muted">
                  {
                    [
                      "Low observed risk does not verify authenticity. No configured indicators were triggered.",
                      "Request more context about device and contact sharing. The evidence supports review, not a definitive fraud conclusion.",
                      "Prioritise review of the linked registration cluster. Multiple independent categories contribute.",
                    ][i]
                  }
                </p>
              </div>
              <div className="compare-section">
                <h3>What evidence would change this assessment?</h3>
                <p className="small muted">
                  {
                    [
                      "New conflicts or coordinated registrations could raise risk.",
                      "Verified household context could clarify the review; correcting observed evidence would recalculate the score.",
                      "Correcting reused tokens or conflicting records could lower risk.",
                    ][i]
                  }
                </p>
              </div>
              <button className="btn" onClick={() => onSelect(id)}>
                <Search className="icon" />
                Inspect complete case
              </button>
            </article>
          );
        })}
      </div>
      <div className="info-banner">
        <ShieldCheck className="icon" />
        <div>
          <strong>
            Scenario labels describe the synthetic generator’s intent.
          </strong>
          <br />
          The risk engine never receives these labels. An ambiguous case remains
          uncertain because the evidence permits more than one explanation.
        </div>
      </div>
    </>
  );
}
