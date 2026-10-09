import { useEffect, useState } from "react";
import { api } from "./api";
import type { CaseDetail, TeamMember } from "./org-types";
import { when } from "./org-types";
interface Request {
  id: string;
  category: string;
  description: string;
  status: string;
  resolution: string;
  assignedTo: string | null;
  dueAt: string | null;
  revision: number;
}
const categories = [
  "Profile comparison",
  "Email history",
  "Phone verification",
  "Device telemetry",
  "Session region",
  "Form behaviour",
  "Relationship tokens",
  "Other",
];
export function EvidenceRequests({
  detail,
  team,
  canWrite,
  onUpdated,
}: {
  detail: CaseDetail;
  team: TeamMember[];
  canWrite: boolean;
  onUpdated: () => Promise<void>;
}) {
  const [items, setItems] = useState<Request[]>([]),
    [error, setError] = useState("");
  const [category, setCategory] = useState(
      detail.assessment.coverage.missing[0] || "Other",
    ),
    [description, setDescription] = useState(""),
    [assigned, setAssigned] = useState(""),
    [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    api<Request[]>(`/org/cases/${detail.id}/requests`).then(setItems);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [detail.id]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/org/cases/${detail.id}/requests`, {
        method: "POST",
        body: JSON.stringify({
          case_revision: detail.revision,
          category,
          description,
          assigned_to: assigned || null,
          due_at: due ? new Date(due).toISOString() : null,
        }),
      });
      setDescription("");
      await Promise.all([load(), onUpdated()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function close(row: Request, status: string, resolution: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/org/cases/${detail.id}/requests/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ revision: row.revision, status, resolution }),
      });
      await Promise.all([load(), onUpdated()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel org-review">
      <div className="section-title">
        <div>
          <div className="eyebrow">Follow up on evidence gaps</div>
          <h2>Evidence requests</h2>
        </div>
        <span className="small muted">
          {items.filter((r) => r.status === "Open").length} open
        </span>
      </div>
      <p className="muted">
        Tasks stay inside your team. They do not send an applicant message,
        verify a source, or change risk by themselves.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {canWrite && (
        <details className="org-request-create">
          <summary>Request additional evidence</summary>
          <form className="org-form" onSubmit={create}>
            <div className="org-form-row">
              <label>
                Evidence category
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Request owner
                <select
                  value={assigned}
                  onChange={(e) => setAssigned(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {team
                    .filter((t) => t.active && t.role !== "viewer")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              What evidence is needed?
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </label>
            <label>
              Due date (optional)
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={busy}>
              Create evidence request
            </button>
          </form>
        </details>
      )}
      {!items.length && (
        <p className="small muted org-table-empty">
          No follow-up requests recorded.
        </p>
      )}
      {items.map((row) => (
        <RequestCard
          key={row.id}
          row={row}
          team={team}
          canWrite={canWrite}
          busy={busy}
          onClose={close}
        />
      ))}
    </section>
  );
}
function RequestCard({
  row,
  team,
  canWrite,
  busy,
  onClose,
}: {
  row: Request;
  team: TeamMember[];
  canWrite: boolean;
  busy: boolean;
  onClose: (r: Request, s: string, reason: string) => Promise<void>;
}) {
  const [resolution, setResolution] = useState(""),
    [status, setStatus] = useState("Resolved");
  const overdue =
    row.status === "Open" && row.dueAt && new Date(row.dueAt) < new Date();
  return (
    <article className="org-request-card">
      <div className="section-title">
        <h3>{row.category}</h3>
        <span
          className={`pill ${overdue ? "Review" : row.status === "Open" ? "Pending" : "Low"}`}
        >
          {overdue ? "Overdue" : row.status}
        </span>
      </div>
      <p>{row.description}</p>
      <p className="small muted">
        Owner: {team.find((t) => t.id === row.assignedTo)?.name || "Unassigned"}
        {row.dueAt ? ` · Due ${when(row.dueAt)}` : ""}
      </p>
      {row.resolution && (
        <p className="small">Closure note: {row.resolution}</p>
      )}
      {row.status === "Open" && canWrite && (
        <details>
          <summary>Close this request</summary>
          <form
            className="org-form"
            onSubmit={(e) => {
              e.preventDefault();
              void onClose(row, status, resolution);
            }}
          >
            <label>
              Closure status · {row.category}
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option>Resolved</option>
                <option>Cancelled</option>
              </select>
            </label>
            <label>
              Resolution note · {row.category}
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={2}
              />
            </label>
            <button className="btn" disabled={busy}>
              Close {row.category} request
            </button>
          </form>
        </details>
      )}
    </article>
  );
}
