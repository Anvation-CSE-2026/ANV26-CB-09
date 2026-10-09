import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  Search,
  Plus,
  FileText,
  RefreshCw,
} from "lucide-react";
import { api, download } from "./api";
import { Breakdown } from "./App";
import { OrganisationComparison } from "./OrganisationComparison";
import { WorkspaceSetup } from "./WorkspaceSetup";
import { EvidenceRequests } from "./EvidenceRequests";
import {
  EvidenceEditor,
  EvidenceModal,
  emptyEvidence,
  evidenceDraft,
} from "./EvidenceEditor";
import type { Assessment } from "./types";
import type {
  OrgUser,
  OrgCase,
  CaseDetail,
  TeamMember,
  OrgAssessment,
} from "./org-types";
import { readable, when } from "./org-types";
const Graph = lazy(() => import("./Graph").then((m) => ({ default: m.Graph })));
function Risk({ value }: { value: OrgAssessment }) {
  return (
    <span className={`pill ${value.band}`}>
      {value.band === "Pending"
        ? "Awaiting activity"
        : value.band === "Review"
          ? "Needs review"
          : value.band + " risk"}
    </span>
  );
}

export function OrganisationCases({
  cases,
  user,
  refresh,
  notify,
  onNavigate,
}: {
  cases: OrgCase[];
  user: OrgUser;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  onNavigate: (
    p: "cases" | "imports" | "integrations" | "team" | "audit" | "hosted",
  ) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [band, setBand] = useState("all");
  const [creating, setCreating] = useState(false),
    [draft, setDraft] = useState(emptyEvidence());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [reviewFilter, setReviewFilter] = useState("all"),
    [ownerFilter, setOwnerFilter] = useState("all"),
    [missingOnly, setMissingOnly] = useState(false);
  const [comparing, setComparing] = useState(false);
  const results = useMemo(
    () =>
      new Map(
        cases
          .filter((r) => r.assessment.score !== null)
          .map((r) => [r.id, r.assessment as Assessment]),
      ),
    [cases],
  );
  const filtered = cases
    .filter(
      (r) =>
        (band === "all" || r.assessment.band === band) &&
        (reviewFilter === "all" || r.status === reviewFilter) &&
        (ownerFilter === "all" ||
          (ownerFilter === "mine"
            ? r.assignedTo === user.id
            : !r.assignedTo)) &&
        (!missingOnly || r.assessment.coverage.status === "Incomplete") &&
        r.externalId.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (b.assessment.score ?? -1) - (a.assessment.score ?? -1));
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const evidence = draft;
      const created = await api<{ id: string }>("/org/cases", {
        method: "POST",
        body: JSON.stringify(evidence),
      });
      await refresh();
      setCreating(false);
      setSelected(created.id);
      notify("Applicant evidence saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (selected)
    return (
      <CaseInvestigation
        key={selected}
        id={selected}
        user={user}
        results={results}
        onBack={() => setSelected(null)}
        onSelect={setSelected}
        refresh={refresh}
        notify={notify}
      />
    );
  if (comparing)
    return (
      <OrganisationComparison
        cases={cases}
        onBack={() => setComparing(false)}
        onSelect={setSelected}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your organisation’s evidence</div>
          <h1>Investigations</h1>
          <p>
            Prioritise cases, inspect supporting records and keep decisions
            traceable.
          </p>
        </div>
        <div className="org-actions">
          {cases.length > 1 && (
            <button className="btn" onClick={() => setComparing(true)}>
              Compare cases
            </button>
          )}
          <button
            className="btn"
            onClick={() => refresh().catch((e) => notify(e.message))}
          >
            <RefreshCw className="icon" />
            Refresh
          </button>
          {user.role !== "viewer" && (
            <button
              className="btn primary"
              onClick={() => {
                setDraft(emptyEvidence());
                setCreating(true);
                setError("");
              }}
            >
              <Plus className="icon" />
              Add applicant
            </button>
          )}
        </div>
      </div>
      <WorkspaceSetup cases={cases} user={user} onNavigate={onNavigate} />
      <div className="org-summary">
        <div>
          <span>Applicants</span>
          <strong>{cases.length}</strong>
        </div>
        <div>
          <span>High risk</span>
          <strong>
            {cases.filter((c) => c.assessment.band === "High").length}
          </strong>
        </div>
        <div>
          <span>Needs review</span>
          <strong>
            {
              cases.filter(
                (c) =>
                  c.assessment.band === "Review" ||
                  c.assessment.coverage.status === "Incomplete",
              ).length
            }
          </strong>
        </div>
        <div>
          <span>Awaiting activity</span>
          <strong>
            {cases.filter((c) => c.assessment.band === "Pending").length}
          </strong>
        </div>
      </div>
      {!cases.length ? (
        <section className="org-empty">
          <div className="org-empty-symbol">
            <FileText size={34} />
          </div>
          <h2>Your workspace starts with your evidence.</h2>
          <p>
            Import a synthetic dataset or connect a registration system. Records
            you add here belong only to {user.organisationName}.
          </p>
          {user.role !== "viewer" && (
            <div className="org-actions">
              <button
                className="btn primary"
                onClick={() => onNavigate("imports")}
              >
                Import your first dataset
                <ArrowUpRight className="icon" />
              </button>
              {user.role === "admin" && (
                <button
                  className="btn"
                  onClick={() => onNavigate("integrations")}
                >
                  Set up a connection
                </button>
              )}
            </div>
          )}
          <p className="small muted">
            Your organisation starts empty. Use Sample cases in navigation to
            explore the evidence policy without changing this workspace.
          </p>
        </section>
      ) : (
        <section className="panel org-case-list">
          <div className="org-list-toolbar">
            <div className="org-search">
              <Search className="icon" />
              <input
                type="search"
                aria-label="Search applicants"
                placeholder="Search applicant ID"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <select
              aria-label="Filter risk band"
              value={band}
              onChange={(e) => {
                setBand(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All risk bands</option>
              {["Low", "Review", "High", "Pending"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              aria-label="Filter review status"
              value={reviewFilter}
              onChange={(e) => {
                setReviewFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All review statuses</option>
              {[
                "Unreviewed",
                "In review",
                "Needs evidence",
                "Review complete",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              aria-label="Filter assignment"
              value={ownerFilter}
              onChange={(e) => {
                setOwnerFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All assignments</option>
              {user.role !== "viewer" && (
                <option value="mine">Assigned to me</option>
              )}
              <option value="unassigned">Unassigned</option>
            </select>
            <label className="org-filter-check">
              <input
                type="checkbox"
                checked={missingOnly}
                onChange={(e) => {
                  setMissingOnly(e.target.checked);
                  setPage(0);
                }}
              />
              Missing evidence only
            </label>
          </div>
          <div className="org-table-scroll">
            <table className="org-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Risk assessment</th>
                  <th>Evidence coverage</th>
                  <th>Review status</th>
                  <th>Registered in workspace</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * 15, (page + 1) * 15).map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        className="text-link org-identifier"
                        onClick={() => setSelected(row.id)}
                      >
                        {row.externalId}
                      </button>
                    </td>
                    <td>
                      <span className="org-score">
                        {row.assessment.score ?? "—"}
                      </span>
                      <Risk value={row.assessment} />
                    </td>
                    <td>
                      <span>{row.assessment.coverage.percent}%</span>
                      <div className="small muted">
                        {row.assessment.coverage.status}
                      </div>
                    </td>
                    <td>{row.status}</td>
                    <td className="small">{when(row.createdAt)}</td>
                    <td>
                      <button
                        className="btn subtle"
                        aria-label={`Inspect ${row.externalId}`}
                        onClick={() => setSelected(row.id)}
                      >
                        <ArrowUpRight className="icon" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <p className="org-table-empty">No applicants match this search.</p>
          )}
          <div className="org-pagination">
            <span className="small muted">{filtered.length} applicants</span>
            <button
              className="btn"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="btn"
              disabled={(page + 1) * 15 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </section>
      )}
      {creating && (
        <EvidenceModal
          title="Add applicant evidence"
          busy={busy}
          onClose={() => setCreating(false)}
        >
          <form className="org-form" onSubmit={create}>
            <EvidenceEditor value={draft} onChange={setDraft} disabled={busy} />
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Save applicant"}
            </button>
          </form>
        </EvidenceModal>
      )}
    </>
  );
}

function CaseInvestigation({
  id,
  user,
  results,
  onBack,
  onSelect,
  refresh,
  notify,
}: {
  id: string;
  user: OrgUser;
  results: Map<string, Assessment>;
  onBack: () => void;
  onSelect: (id: string) => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [detail, setDetail] = useState<CaseDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("evidence"),
    [team, setTeam] = useState<TeamMember[]>([]);
  const [status, setStatus] = useState("Unreviewed"),
    [assigned, setAssigned] = useState(""),
    [note, setNote] = useState("");
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(emptyEvidence()),
    [reason, setReason] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]),
    [simulation, setSimulation] = useState<OrgAssessment | null>(null);
  async function load() {
    const [record, members] = await Promise.all([
      api<CaseDetail>(`/org/cases/${id}`),
      api<TeamMember[]>("/org/team"),
    ]);
    setDetail(record);
    setTeam(members);
    setStatus(record.status);
    setAssigned(record.assignedTo || "");
    setError("");
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      api<CaseDetail>(`/org/cases/${id}`),
      api<TeamMember[]>("/org/team"),
    ])
      .then(([record, members]) => {
        if (active) {
          setDetail(record);
          setTeam(members);
          setStatus(record.status);
          setAssigned(record.assignedTo || "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (!detail) return;
    let active = true;
    api<OrgAssessment>(`/org/cases/${id}/sensitivity`, {
      method: "POST",
      body: JSON.stringify({ excluded }),
    })
      .then((r) => {
        if (active) setSimulation(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, excluded, detail]);
  async function saveReview(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api(`/org/cases/${id}/review`, {
        method: "PUT",
        body: JSON.stringify({
          revision: detail.revision,
          status,
          note,
          assigned_to: assigned || null,
        }),
      });
      setNote("");
      await load();
      await refresh();
      notify("Review saved with an audit record.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function correct(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const evidence = draft;
      await api(`/org/cases/${id}/evidence`, {
        method: "PUT",
        body: JSON.stringify({ revision: detail.revision, reason, evidence }),
      });
      setExcluded([]);
      setEditing(false);
      await load();
      await refresh();
      notify("Evidence corrected. Previous assessment history is retained.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!detail)
    return (
      <>
        <button className="btn" onClick={onBack}>
          <ArrowLeft className="icon" />
          All applicants
        </button>
        <p role={error ? "alert" : "status"}>
          {error || "Loading sourced evidence…"}
        </p>
      </>
    );
  const assessment = detail.assessment,
    canWrite = user.role !== "viewer";
  return (
    <>
      <button className="btn org-back" onClick={onBack}>
        <ArrowLeft className="icon" />
        All applicants
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Applicant investigation</div>
          <h1>{detail.externalId}</h1>
          <p>
            Evidence revision {detail.evidenceRevision} · {detail.status}
          </p>
        </div>
        <div className="org-actions">
          <button
            className="btn"
            onClick={() =>
              api(`/org/cases/${id}/report`)
                .then((r) => download(`${detail.externalId}-report.json`, r))
                .catch((e) => notify(e.message))
            }
          >
            <Download className="icon" />
            Export report
          </button>
          {canWrite && (
            <button
              className="btn"
              onClick={() => {
                setDraft(evidenceDraft(detail.evidence));
                setReason("");
                setEditing(true);
              }}
            >
              Correct evidence
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}{" "}
          <button
            className="text-link"
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Reload case
          </button>
        </p>
      )}
      <div className="org-assessment-grid">
        <section className="panel org-assessment">
          <div>
            <span className="eyebrow">Policy risk index</span>
            <div className="org-big-score">
              {assessment.score ?? "—"}
              <span>
                {assessment.score !== null ? "/ 100" : "Awaiting activity"}
              </span>
            </div>
            <Risk value={assessment} />
          </div>
          <div>
            <h3>Assessment rationale</h3>
            <p>{assessment.explanation}</p>
            <p className="small muted">
              Rules and robust statistics. Scores are not fraud probabilities.
            </p>
          </div>
        </section>
        <section className="panel org-coverage">
          <div className="eyebrow">Evidence coverage</div>
          <h2>
            {assessment.coverage.percent}%{" "}
            <span className="muted">available</span>
          </h2>
          <p>
            {assessment.coverage.missing.length
              ? "Missing: " + assessment.coverage.missing.join(", ")
              : "All configured evidence groups have supplied observations."}
          </p>
          <p className="small muted">
            Coverage describes available inputs; it is not confidence or
            accuracy.
          </p>
          <p className="small muted">
            Source types:{" "}
            {[...new Set(detail.events.map((e) => readable(e.source)))].join(
              ", ",
            ) || "Analyst-supplied profile; no session observations"}
            . Source labels show how evidence arrived—not independent provider
            verification.
          </p>
        </section>
      </div>
      <div
        className="org-tabs"
        role="tablist"
        aria-label="Case investigation views"
      >
        {["evidence", "relationships", "activity", "history"].map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      <section className="panel org-investigation" role="tabpanel">
        {tab === "evidence" && (
          <>
            <div className="org-evidence-columns">
              <div>
                <h2>Contributing indicators</h2>
                {!assessment.indicators.length && (
                  <p className="muted">
                    {assessment.band === "Pending"
                      ? "No assessment has been assigned."
                      : "No configured risk indicator was triggered by the available evidence."}
                  </p>
                )}
                {assessment.indicators.map((indicator) => (
                  <article className="org-indicator" key={indicator.id}>
                    <div className="section-title">
                      <h3>{indicator.title}</h3>
                      <strong>+{indicator.points} raw</strong>
                    </div>
                    <p>{indicator.observed}</p>
                    <p className="small muted">{indicator.reason}</p>
                    <p className="small">Context: {indicator.context}</p>
                    {indicator.sourceRecords?.length ? (
                      <details>
                        <summary>Source records for this indicator</summary>
                        <pre className="org-code">
                          {JSON.stringify(indicator.sourceRecords, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                    <label className="org-omit">
                      <input
                        type="checkbox"
                        checked={excluded.includes(indicator.id)}
                        onChange={(e) =>
                          setExcluded(
                            e.target.checked
                              ? [...excluded, indicator.id]
                              : excluded.filter((v) => v !== indicator.id),
                          )
                        }
                      />
                      Omit in what-if assessment
                    </label>
                  </article>
                ))}
              </div>
              <aside>
                <h3>Capped evidence groups</h3>
                {assessment.score !== null && (
                  <Breakdown result={assessment as Assessment} />
                )}
                <div className="org-sensitivity">
                  <span className="eyebrow">What-if assessment</span>
                  <strong>{simulation?.score ?? "—"} / 100</strong>
                  <p className="small">
                    Omitted indicators change this calculation only. Stored
                    evidence and assessment remain unchanged.
                  </p>
                </div>
                <details>
                  <summary>Inspect supplied evidence records</summary>
                  <pre className="org-code">
                    {JSON.stringify(detail.evidence, null, 2)}
                  </pre>
                </details>
              </aside>
            </div>
          </>
        )}
        {tab === "relationships" && (
          <>
            <h2>Exact-token relationships</h2>
            <p className="muted">
              Links stay inside your organisation. Related applicants’ scores
              are never propagated.
            </p>
            {assessment.score !== null && assessment.links.length ? (
              <Suspense
                fallback={<p role="status">Loading relationship graph…</p>}
              >
                <Graph
                  result={assessment as Assessment}
                  results={results}
                  onSelect={onSelect}
                />
              </Suspense>
            ) : (
              <p className="org-table-empty">
                No shared-token relationships are available.
              </p>
            )}
          </>
        )}
        {tab === "activity" && (
          <>
            <h2>Event provenance</h2>
            <p className="muted">
              Source time and receipt time show where each observation came
              from.
            </p>
            {detail.events.map((event) => (
              <details className="org-event" key={event.id}>
                <summary>
                  <strong>{readable(event.source)}</strong>
                  <span>{when(event.receivedAt)}</span>
                </summary>
                <pre className="org-code">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            ))}
            {!detail.events.length && (
              <p className="org-table-empty">
                No sourced activity has been received.
              </p>
            )}
          </>
        )}
        {tab === "history" && (
          <>
            <h2>Assessment history</h2>
            <table className="org-table">
              <thead>
                <tr>
                  <th>Recorded</th>
                  <th>Risk index</th>
                  <th>Evidence revision</th>
                  <th>Policy</th>
                </tr>
              </thead>
              <tbody>
                {detail.history.map((h) => (
                  <tr key={h.id}>
                    <td>{when(h.timestamp)}</td>
                    <td>
                      {h.score ?? "Awaiting activity"} · {h.band}
                    </td>
                    <td>{h.evidenceRevision}</td>
                    <td>{h.policyVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      <EvidenceRequests
        detail={detail}
        team={team}
        canWrite={canWrite}
        onUpdated={async () => {
          await load();
          await refresh();
          notify("Evidence follow-up saved.");
        }}
      />
      <section className="panel org-review">
        <h2>Analyst review</h2>
        <p className="muted">
          Assign a case, record context and request further evidence. Review
          completion does not approve or deny an applicant.
        </p>
        <form className="org-form" onSubmit={saveReview}>
          <div className="org-form-row">
            <label>
              Review status
              <select
                value={status}
                disabled={!canWrite || busy}
                onChange={(e) => setStatus(e.target.value)}
              >
                {[
                  "Unreviewed",
                  "In review",
                  "Needs evidence",
                  "Review complete",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Assigned analyst
              <select
                value={assigned}
                disabled={!canWrite || busy}
                onChange={(e) => setAssigned(e.target.value)}
              >
                <option value="">Unassigned</option>
                {team
                  .filter((m) => m.active && m.role !== "viewer")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            Review note
            <textarea
              aria-label="Review note"
              rows={3}
              maxLength={4000}
              value={note}
              disabled={!canWrite || busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="btn primary" disabled={!canWrite || busy}>
            {busy ? "Saving…" : "Save review"}
          </button>
        </form>
        <div className="org-review-trail">
          {detail.audit.map((item) => (
            <article key={item.id}>
              <div className="section-title">
                <strong>{readable(item.action)}</strong>
                <span className="small muted">{when(item.timestamp)}</span>
              </div>
              {typeof item.details.note === "string" && item.details.note && (
                <p>{item.details.note}</p>
              )}
              {typeof item.details.reason === "string" && (
                <p>{item.details.reason}</p>
              )}
              <span className="small muted">
                {team.find((m) => m.id === item.actor)?.name || "Integration"}
              </span>
            </article>
          ))}
        </div>
      </section>
      {editing && (
        <EvidenceModal
          title="Correct supplied evidence"
          busy={busy}
          onClose={() => setEditing(false)}
        >
          <p>
            Previous evidence remains in the audit trail. Shared relationships
            will be reassessed when source records change.
          </p>
          <form className="org-form" onSubmit={correct}>
            <label>
              Reason for correction
              <textarea
                aria-label="Reason for correction"
                required
                minLength={5}
                maxLength={1000}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <EvidenceEditor
              value={draft}
              onChange={setDraft}
              lockedId
              disabled={busy}
            />
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              {busy ? "Reassessing…" : "Save correction and reassess"}
            </button>
          </form>
        </EvidenceModal>
      )}
    </>
  );
}
