import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Link2,
  RefreshCw,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import type { OrgCase, OrgUser } from "./org-types";
import { when } from "./org-types";

interface ActivityLink {
  id: string;
  caseId: string;
  externalId: string;
  status: string;
  expiresAt: string;
  completedAt: string | null;
  summary: { formSeconds: number; editCount: number; trust: string } | null;
}

export function HostedActivity({
  cases,
  user,
  refresh,
  onInvestigations,
}: {
  cases: OrgCase[];
  user: OrgUser;
  refresh: () => Promise<void>;
  onInvestigations: () => void;
}) {
  const [links, setLinks] = useState<ActivityLink[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState("");
  const [issued, setIssued] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const response = await api<{ enabled: boolean; links: ActivityLink[] }>(
      "/org/hosted-links",
    );
    setLinks(response.links);
    setEnabled(response.enabled);
  }, []);
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (!active || document.visibilityState !== "visible") return;
      try {
        await Promise.all([load(), refresh()]);
        if (active) setError("");
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    check();
    const interval = setInterval(check, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [load, refresh]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setIssued(null);
    try {
      const link = await api<{ token: string; expiresAt: string }>(
        "/org/hosted-links",
        {
          method: "POST",
          body: JSON.stringify({ case_id: selected, synthetic: true }),
        },
      );
      setIssued({
        url: `${location.origin}/?view=activity#access=${encodeURIComponent(link.token)}`,
        expiresAt: link.expiresAt,
      });
      await load();
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
      await api(`/org/hosted-links/${id}`, { method: "DELETE" });
      setIssued(null);
      await load();
      setNotice(
        "Activity link revoked. Previously received evidence is retained.",
      );
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
          <div className="eyebrow">First-party activity, collected here</div>
          <h1>Hosted activity</h1>
          <p>
            Invite an applicant to a page on Identity Lens. Receive a disclosed
            interaction summary and inspect its evidence.
          </p>
        </div>
        <Link2 size={30} />
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
      <div className="org-import-grid">
        <section className="panel org-settings-panel">
          <h2>Invite an applicant</h2>
          <p className="muted">
            Add an applicant in Investigations or import records first. A link
            is limited to that applicant, expires in 30 minutes and accepts one
            completed summary.
          </p>
          {user.role === "viewer" ? (
            <p>
              Viewer access can inspect received activity, but cannot issue or
              revoke links.
            </p>
          ) : (
            <form className="org-form" onSubmit={create}>
              <label>
                Applicant
                <select
                  aria-label="Hosted activity applicant"
                  value={selected}
                  required
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Choose an applicant</option>
                  {cases.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.externalId}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn primary"
                disabled={busy || !enabled || !cases.length || !selected}
              >
                Create activity link
              </button>
            </form>
          )}
          {!enabled && (
            <p className="small muted">
              Hosted collection is disabled by the instance operator.
            </p>
          )}
          {!cases.length && (
            <button className="text-link" onClick={onInvestigations}>
              Add your first applicant <ArrowUpRight className="icon" />
            </button>
          )}
          {issued && (
            <div className="org-hosted-issued" role="status">
              <strong>Activity link ready</strong>
              <p className="small">
                Expires {when(issued.expiresAt)}. Copy it now; the full link is
                not stored. Anyone holding it can submit this one applicant's
                summary—not access the organisation.
              </p>
              <div className="org-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(issued.url)
                      .then(() =>
                        setNotice(
                          "Activity link copied. Share it only with the intended applicant.",
                        ),
                      )
                      .catch(() =>
                        setError(
                          "Clipboard unavailable. Use Open activity page on this device.",
                        ),
                      )
                  }
                >
                  <Copy className="icon" /> Copy activity link
                </button>
                <a className="btn primary" href={issued.url}>
                  Open activity page <ArrowUpRight className="icon" />
                </a>
              </div>
            </div>
          )}
        </section>
        <aside className="panel org-settings-panel">
          <div className="eyebrow">What Identity Lens observes</div>
          <h2>Small signals. Clear boundaries.</h2>
          <ul className="org-guidance">
            <li>Duration of the hosted applicant form interaction.</li>
            <li>Number of non-sensitive field changes—not their values.</li>
            <li>
              An organisation-scoped browser-storage token, created after
              acknowledgement.
            </li>
          </ul>
          <p>
            Activity is sent on completion only. Nothing is measured before the
            notice is acknowledged; applicants can stop without sending a
            summary.
          </p>
          <p className="small muted">
            Fictional applicant records only. Counts are measured in this page,
            but remain client-reported. Tokens are resettable and are not
            physical-device identity. No passwords, typed values, IPs, GPS or
            activity on other websites are collected.
          </p>
          <p className="small">
            <ShieldCheck className="icon" /> No private server key is needed in
            the applicant browser.
          </p>
        </aside>
      </div>
      <section className="panel org-settings-panel">
        <div className="section-title">
          <div>
            <div className="eyebrow">
              Recent invitations and received activity
            </div>
            <h2>Activity overview</h2>
            <p className="small muted">
              Latest 100 links. Refreshes every 10 seconds while this view is
              visible. Open Investigations for source records and assessment
              history.
            </p>
          </div>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              Promise.all([load(), refresh()]).catch((e) => setError(e.message))
            }
          >
            <RefreshCw className="icon" /> Refresh activity
          </button>
        </div>
        {!links.length ? (
          <p className="org-table-empty">
            No activity links yet. Existing applicants remain available in
            Investigations.
          </p>
        ) : (
          <div className="org-table-scroll">
            <table className="org-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Collection</th>
                  <th>Observed summary</th>
                  <th>Current assessment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {links.map((link) => {
                  const assessment = cases.find(
                    (row) => row.id === link.caseId,
                  )?.assessment;
                  return (
                    <tr key={link.id}>
                      <td>
                        <strong>{link.externalId}</strong>
                        <div className="small muted">
                          {link.completedAt
                            ? `Received ${when(link.completedAt)}`
                            : `Expires ${when(link.expiresAt)}`}
                        </div>
                      </td>
                      <td>{link.status}</td>
                      <td>
                        {link.summary ? (
                          <>
                            <strong>
                              {link.summary.formSeconds.toFixed(1)}s
                            </strong>{" "}
                            · {link.summary.editCount} changes
                            <div className="small muted">
                              Measured here · client-reported
                            </div>
                          </>
                        ) : (
                          "No summary received"
                        )}
                      </td>
                      <td>
                        {assessment ? (
                          <>
                            <span className={`pill ${assessment.band}`}>
                              {assessment.band === "Pending"
                                ? "Pending"
                                : `${assessment.score} / 100 · ${assessment.band}`}
                            </span>
                            <div className="small muted">
                              {assessment.indicators.length} indicators · not a
                              fraud probability
                            </div>
                          </>
                        ) : (
                          "Refresh to inspect"
                        )}
                      </td>
                      <td>
                        {user.role !== "viewer" &&
                          ["Awaiting applicant", "In progress"].includes(
                            link.status,
                          ) && (
                            <button
                              className="btn"
                              disabled={busy}
                              onClick={() => revoke(link.id)}
                            >
                              Revoke link
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <button className="text-link" onClick={onInvestigations}>
          Open Investigations <ArrowUpRight className="icon" />
        </button>
      </section>
    </>
  );
}
