import { useEffect, useState } from "react";
import {
  Copy,
  Download,
  Upload,
  Cable,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { api, download } from "./api";
import type { OrgUser, TeamMember, AuditItem } from "./org-types";
import { when, readable } from "./org-types";

export function OrganisationSettings({
  page,
  user,
  refresh,
  notify,
}: {
  page: "imports" | "integrations" | "team" | "audit";
  user: OrgUser;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  if (page === "imports")
    return <Imports user={user} refresh={refresh} notify={notify} />;
  if (page === "integrations") return <Connections notify={notify} />;
  if (page === "team") return <Team user={user} notify={notify} />;
  return <Audit />;
}

interface Preview {
  valid: boolean;
  acceptedCount: number;
  errors: { row: number; message: string }[];
  preview: {
    externalId: string;
    sessions: number;
    coverage: { percent: number; status: string };
  }[];
}
function Imports({
  user,
  refresh,
  notify,
}: {
  user: OrgUser;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [content, setContent] = useState(""),
    [filename, setFilename] = useState("");
  const [format, setFormat] = useState("json"),
    [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [batches, setBatches] = useState<
    { id: string; filename: string; count: number; timestamp: string }[]
  >([]);
  const load = () => api<typeof batches>("/org/imports").then(setBatches);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function fileSelected(file?: File) {
    if (!file) return;
    setPreview(null);
    setError("");
    if (file.size > 1500000) {
      setError(
        "Choose a file smaller than 1.5 MB, with up to 100 applicants per batch.",
      );
      return;
    }
    setFilename(file.name);
    setFormat(file.name.toLowerCase().endsWith(".csv") ? "csv" : "json");
    setContent(await file.text());
  }
  async function validate() {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      setPreview(
        await api<Preview>("/org/imports/preview", {
          method: "POST",
          body: JSON.stringify({
            format,
            content,
            filename: filename || "dataset",
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ importedCount: number }>("/org/imports", {
        method: "POST",
        body: JSON.stringify({
          format,
          content,
          filename: filename || "dataset",
        }),
      });
      await Promise.all([refresh(), load()]);
      setPreview(null);
      setContent("");
      setFilename("");
      notify(`${result.importedCount} applicants imported and assessed.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sample() {
    try {
      const rows = await api<unknown[]>("/org/sample-dataset");
      download("identity-lens-synthetic-dataset.json", rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Bring your evidence into the workspace</div>
          <h1>Import evidence</h1>
          <p>
            Preview a dataset, resolve errors and import a complete batch into
            your organisation.
          </p>
        </div>
        <button className="btn" onClick={sample}>
          <Download className="icon" />
          Download synthetic sample
        </button>
      </div>
      <div className="org-import-grid">
        <section className="panel org-settings-panel">
          <h2>Upload a dataset</h2>
          <p className="muted">
            JSON arrays and CSV files are supported. Use the sample to see the
            required schema. CSV profile_records and sessions cells contain JSON
            arrays.
          </p>
          <div className="org-dropzone">
            <Upload size={28} />
            <label>
              Choose JSON or CSV
              <input
                type="file"
                aria-label="Choose evidence dataset"
                accept=".json,.csv"
                disabled={user.role === "viewer" || busy}
                onChange={(e) => fileSelected(e.target.files?.[0])}
              />
            </label>
            <span className="small muted">
              Up to 100 applicants per batch · 1.5 MB
            </span>
          </div>
          <form
            className="org-form"
            onSubmit={(e) => {
              e.preventDefault();
              validate();
            }}
          >
            <div className="org-form-row">
              <label>
                Dataset name
                <input
                  value={filename}
                  maxLength={100}
                  onChange={(e) => {
                    setFilename(e.target.value);
                    setPreview(null);
                  }}
                  placeholder="registration-evidence.json"
                  disabled={user.role === "viewer" || busy}
                />
              </label>
              <label>
                Format
                <select
                  value={format}
                  disabled={busy || user.role === "viewer"}
                  onChange={(e) => {
                    setFormat(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
            </div>
            <label>
              Dataset contents
              <textarea
                className="org-json"
                rows={9}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setPreview(null);
                }}
                disabled={user.role === "viewer" || busy}
                spellCheck={false}
              />
            </label>
            <button
              className="btn primary"
              disabled={!content || busy || user.role === "viewer"}
            >
              {busy ? "Processing…" : "Validate and preview"}
            </button>
          </form>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </section>
        <aside className="panel org-settings-panel">
          <div className="eyebrow">Evidence contract</div>
          <h2>Make uncertainty visible.</h2>
          <ul className="org-guidance">
            <li>
              Every record declares <code>synthetic: true</code>.
            </li>
            <li>External applicant IDs are unique inside your organisation.</li>
            <li>
              Use timestamped sessions and invented device, phone and address
              tokens.
            </li>
            <li>
              Unavailable fields stay null. Missing evidence is not treated as
              verified.
            </li>
            <li>
              Duplicate or invalid records block the whole import. No partial
              batch is committed.
            </li>
          </ul>
          <a
            href="http://127.0.0.1:8000/docs"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Open the evidence API documentation
          </a>
        </aside>
      </div>
      {preview && (
        <section className="panel org-settings-panel">
          <div className="section-title">
            <div>
              <h2>Import preview</h2>
              <p>
                {preview.acceptedCount} valid applicants ·{" "}
                {preview.errors.length} issues
              </p>
            </div>
            <button
              className="btn primary"
              disabled={!preview.valid || busy || user.role === "viewer"}
              onClick={commit}
            >
              Import validated dataset
            </button>
          </div>
          {preview.errors.length > 0 && (
            <div role="alert" className="inline-error">
              {preview.errors.map((e, i) => (
                <p key={i}>
                  Row {e.row}: {e.message}
                </p>
              ))}
            </div>
          )}
          <div className="org-table-scroll">
            <table className="org-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Sessions</th>
                  <th>Evidence coverage</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((row) => (
                  <tr key={row.externalId}>
                    <td>{row.externalId}</td>
                    <td>{row.sessions}</td>
                    <td>
                      {row.coverage.percent}% · {row.coverage.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel org-settings-panel">
        <h2>Import history</h2>
        {!batches.length ? (
          <p className="org-table-empty">No datasets have been imported yet.</p>
        ) : (
          <div className="org-table-scroll">
            <table className="org-table">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Applicants</th>
                  <th>Imported</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.filename}</td>
                    <td>{batch.count}</td>
                    <td>{when(batch.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

interface Connection {
  id: string;
  name: string;
  origins: string[];
  prefix: string;
  active: boolean;
  lastUsedAt: string | null;
}
interface CollectionStatus {
  browserMeasurementEnabled: boolean;
  dataScope: string;
  signals: string[];
  notCollected: string[];
  limitations: string[];
}
function Connections({ notify }: { notify: (s: string) => void }) {
  const [connections, setConnections] = useState<Connection[]>([]),
    [collection, setCollection] = useState<CollectionStatus | null>(null);
  const [name, setName] = useState("Registration integration"),
    [origins, setOrigins] = useState(location.origin);
  const [secret, setSecret] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    Promise.all([
      api<Connection[]>("/org/integrations"),
      api<CollectionStatus>("/org/collection-status"),
    ]).then(([rows, state]) => {
      setConnections(rows);
      setCollection(state);
    });
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const row = await api<{ secret: string }>("/org/integrations", {
        method: "POST",
        body: JSON.stringify({
          name,
          origins: origins.split(/\s*,\s*/).filter(Boolean),
        }),
      });
      setSecret(row.secret);
      await load();
      notify("Integration created. Save its server key now.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/org/integrations/${id}`, { method: "DELETE" });
      await load();
      notify(
        "Integration revoked. Its key and outstanding collection tickets no longer authorise ingestion.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const integrationCode = `POST ${location.origin}/api/ingest/cases\nX-Lens-Key: <your server integration key>\nContent-Type: application/json\n\n{\n  "synthetic": true,\n  "external_id": "APP-001",\n  "registered_at": "2026-10-08T09:00:00Z",\n  "profile_records": [],\n  "sessions": []\n}`;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Connect your registration workflow</div>
          <h1>Connections</h1>
          <p>
            Connect an external backend when needed. For collection inside
            Identity Lens, use Hosted activity—no integration key is required.
          </p>
        </div>
        <Cable size={30} />
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="org-import-grid">
        <section className="panel org-settings-panel">
          <h2>Create a server integration</h2>
          <p className="muted">
            Keys belong to this organisation and are shown once. Store them on
            your server.
          </p>
          <form className="org-form" onSubmit={create}>
            <label>
              Connection name
              <input
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Allowed website origins
              <input
                required
                value={origins}
                onChange={(e) => setOrigins(e.target.value)}
              />
              <span className="small muted">
                Comma-separated exact origins. External websites require HTTPS.
              </span>
            </label>
            <button className="btn primary" disabled={busy}>
              Create integration key
            </button>
          </form>
          {secret && (
            <div className="org-secret">
              <strong>Save this key before leaving this page</strong>
              <code>{secret}</code>
              <button
                className="btn"
                onClick={() =>
                  navigator.clipboard
                    .writeText(secret)
                    .then(() => notify("Server key copied."))
                    .catch(() => notify("Select and copy the key manually."))
                }
              >
                <Copy className="icon" />
                Copy key
              </button>
              <p className="small">
                Only the key’s hash is stored. To replace a lost key, revoke
                this integration and create another.
              </p>
            </div>
          )}
        </section>
        <aside className="panel org-settings-panel">
          <div className="eyebrow">Collection status</div>
          <h2>External evidence sources</h2>
          <p>
            Server ingestion accepts synthetic profile and session records now.
            The external-site collector is{" "}
            {collection?.browserMeasurementEnabled
              ? "enabled by configuration"
              : "off"}
            . Hosted activity is a separate, notice-gated first-party flow.
          </p>
          <h3>Where signals come from</h3>
          <ul className="org-guidance">
            <li>Form duration and edit counts: the browser collector.</li>
            <li>
              Registrations, verification and failed sign-ins: your backend or
              verification service.
            </li>
            <li>
              Email age and emulator status: an explicit supplied source;
              otherwise unknown.
            </li>
          </ul>
          <p className="small muted">
            A first-party browser token is resettable and can be spoofed. It
            does not uniquely identify a physical device or person.
          </p>
        </aside>
      </div>
      <section className="panel org-settings-panel">
        <h2>Your connections</h2>
        {!connections.length ? (
          <p className="org-table-empty">
            Create a connection to receive a server integration key.
          </p>
        ) : (
          <div className="org-table-scroll">
            <table className="org-table">
              <thead>
                <tr>
                  <th>Connection</th>
                  <th>Key prefix</th>
                  <th>Status</th>
                  <th>Last received request</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connections.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <div className="small muted">
                        {row.origins.join(", ")}
                      </div>
                    </td>
                    <td>
                      <code>{row.prefix}…</code>
                    </td>
                    <td>{row.active ? "Active" : "Revoked"}</td>
                    <td>
                      {row.lastUsedAt
                        ? when(row.lastUsedAt)
                        : "No requests yet"}
                    </td>
                    <td>
                      <button
                        className="btn"
                        disabled={!row.active || busy}
                        onClick={() => revoke(row.id)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel org-settings-panel">
        <h2>Integration instructions</h2>
        <p>
          First create an applicant through the server API. Send subsequent
          timestamped sessions to{" "}
          <code>/api/ingest/cases/APP-001/sessions</code>. Repeated identical
          event IDs are deduplicated.
        </p>
        <pre className="org-code">{integrationCode}</pre>
        <a
          className="text-link"
          href="http://127.0.0.1:8000/docs"
          target="_blank"
          rel="noreferrer"
        >
          Open offline API reference
        </a>
      </section>
    </>
  );
}

function Team({
  user,
  notify,
}: {
  user: OrgUser;
  notify: (s: string) => void;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]),
    [role, setRole] = useState("analyst"),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [link, setLink] = useState("");
  const [invitations, setInvitations] = useState<
    {
      id: string;
      role: string;
      expiresAt: string;
      used: boolean;
      revoked: boolean;
    }[]
  >([]);
  const load = async () => {
    setMembers(await api<TeamMember[]>("/org/team"));
    if (user.role === "admin")
      setInvitations(await api<typeof invitations>("/org/invitations"));
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function invite() {
    setBusy(true);
    setError("");
    try {
      const item = await api<{ token: string }>("/org/invitations", {
        method: "POST",
        body: JSON.stringify({ role }),
      });
      setLink(`${location.origin}/?invite=${encodeURIComponent(item.token)}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function update(member: TeamMember, nextRole: string, active: boolean) {
    setBusy(true);
    setError("");
    try {
      await api(`/org/team/${member.id}`, {
        method: "PUT",
        body: JSON.stringify({ role: nextRole, active }),
      });
      await load();
      notify("Workspace access updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    try {
      await api(`/org/invitations/${id}`, { method: "DELETE" });
      await load();
      notify("Invitation revoked.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">The people behind each review</div>
          <h1>Your team</h1>
          <p>
            Administrators manage access. Analysts investigate and write
            reviews. Viewers inspect and export.
          </p>
        </div>
        <UserPlus size={30} />
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {user.role === "admin" && (
        <section className="panel org-settings-panel">
          <h2>Invite a team member</h2>
          <p>
            Generate a single-use invitation link. Share it through your
            organisation’s trusted channel. It expires in 48 hours.
          </p>
          <div className="org-actions">
            <select
              aria-label="Invitation role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="analyst">Analyst</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Administrator</option>
            </select>
            <button className="btn primary" disabled={busy} onClick={invite}>
              Create invitation
            </button>
          </div>
          {link && (
            <div className="org-secret">
              <code>{link}</code>
              <button
                className="btn"
                onClick={() =>
                  navigator.clipboard
                    .writeText(link)
                    .then(() => notify("Invitation link copied."))
                    .catch(() => notify("Select and copy the link manually."))
                }
              >
                <Copy className="icon" />
                Copy invitation link
              </button>
            </div>
          )}
        </section>
      )}
      <section className="panel org-settings-panel">
        <h2>Workspace members</h2>
        <div className="org-table-scroll">
          <table className="org-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <strong>{member.name}</strong>
                    <div className="small muted">
                      {member.username}
                      {member.id === user.id ? " · You" : ""}
                    </div>
                  </td>
                  <td>
                    {user.role === "admin" ? (
                      <select
                        aria-label={`Role for ${member.username}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(e) =>
                          update(member, e.target.value, member.active)
                        }
                      >
                        <option value="admin">Administrator</option>
                        <option value="analyst">Analyst</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      member.role
                    )}
                  </td>
                  <td>{member.active ? "Active" : "Suspended"}</td>
                  <td>
                    {user.role === "admin" && (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() =>
                          update(member, member.role, !member.active)
                        }
                      >
                        {member.active ? "Suspend access" : "Restore access"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {user.role === "admin" && (
        <section className="panel org-settings-panel">
          <h2>Invitation history</h2>
          {!invitations.length ? (
            <p className="org-table-empty">No invitations have been created.</p>
          ) : (
            <div className="org-table-scroll">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((item) => (
                    <tr key={item.id}>
                      <td>{item.role}</td>
                      <td>{when(item.expiresAt)}</td>
                      <td>
                        {item.revoked
                          ? "Revoked"
                          : item.used
                            ? "Accepted"
                            : new Date(item.expiresAt) < new Date()
                              ? "Expired"
                              : "Available"}
                      </td>
                      <td>
                        <button
                          className="btn"
                          disabled={item.used || item.revoked}
                          onClick={() => revoke(item.id)}
                        >
                          Revoke invitation
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Audit() {
  const [items, setItems] = useState<AuditItem[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<AuditItem[]>("/org/audit")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Accountability across your workspace</div>
          <h1>Activity trail</h1>
          <p>
            Recorded imports, access changes, evidence corrections and analyst
            reviews.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <section className="panel org-settings-panel">
        {!items.length ? (
          <p className="org-table-empty">No activity has been recorded.</p>
        ) : (
          items.map((item) => (
            <details className="org-event" key={item.id}>
              <summary>
                <strong>{readable(item.action)}</strong>
                <span>{when(item.timestamp)}</span>
              </summary>
              <p className="small muted">Actor: {item.actor}</p>
              <pre className="org-code">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            </details>
          ))
        )}
        <p className="small muted">
          Latest 100 events. The application exposes no edit or deletion
          endpoint for this trail.
        </p>
      </section>
    </>
  );
}
