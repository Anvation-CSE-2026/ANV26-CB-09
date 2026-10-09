import { useEffect, useRef, useState } from "react";
import {
  Search,
  ShieldCheck,
  CheckCircle2,
  Timer,
  ArrowLeft,
} from "lucide-react";
import { api, ApiError } from "./api";
import { when } from "./org-types";

interface Collector {
  complete: () => Promise<unknown>;
  stop: () => void;
}
interface CollectorSDK {
  browserToken: (scope: string) => string;
  attach: (options: {
    form: HTMLFormElement;
    ticket: string;
    endpoint: string;
    noticeAcknowledged: true;
  }) => Collector;
}
declare global {
  interface Window {
    IdentityLens?: CollectorSDK;
  }
}
let collectorLoading: Promise<CollectorSDK> | null = null;
function collectorSDK(): Promise<CollectorSDK> {
  if (window.IdentityLens) return Promise.resolve(window.IdentityLens);
  if (!collectorLoading)
    collectorLoading = new Promise<CollectorSDK>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/identity-lens.js";
      script.onload = () =>
        window.IdentityLens
          ? resolve(window.IdentityLens)
          : reject(new Error("The activity collector could not load."));
      script.onerror = () => {
        collectorLoading = null;
        reject(
          new Error(
            "The activity collector could not load. Refresh and try again.",
          ),
        );
      };
      document.head.append(script);
    });
  return collectorLoading;
}
interface AccessInfo {
  organisationName: string;
  externalId: string;
  expiresAt: string;
  status: string;
  storageScope: string;
}
export function HostedActivityPage({
  onOrganisation,
}: {
  onOrganisation: () => void;
}) {
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("access") || "",
  );
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [stage, setStage] = useState<
    "notice" | "active" | "received" | "stopped"
  >("notice");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null),
    collector = useRef<Collector | null>(null);
  useEffect(() => {
    let active = true;
    if (!token) {
      setError(
        "This page needs a private activity link from your organisation.",
      );
      return;
    }
    api<AccessInfo>("/hosted/info", {
      method: "POST",
      credentials: "omit",
      body: JSON.stringify({ token }),
    })
      .then((value) => {
        if (active) {
          setInfo(value);
          if (value.status === "Received") setStage("received");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      collector.current?.stop();
    };
  }, [token]);
  async function start() {
    if (!acknowledged || !info || !form.current) return;
    setBusy(true);
    setError("");
    try {
      const sdk = await collectorSDK();
      const browser = sdk.browserToken(info.storageScope);
      await api("/hosted/start", {
        method: "POST",
        credentials: "omit",
        body: JSON.stringify({
          token,
          synthetic: true,
          notice_acknowledged: true,
          browser_token: browser,
        }),
      });
      collector.current = sdk.attach({
        form: form.current,
        ticket: token,
        endpoint: "/api/hosted/complete",
        noticeAcknowledged: true,
      });
      setStage("active");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function finish(event: React.FormEvent) {
    event.preventDefault();
    if (!collector.current || stage !== "active") return;
    setBusy(true);
    setError("");
    try {
      await collector.current.complete();
      setStage("received");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    collector.current?.stop();
    setStage("stopped");
    setError("");
    try {
      await api("/hosted/cancel", {
        method: "POST",
        credentials: "omit",
        body: JSON.stringify({ token }),
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setStage("received");
      else
        setError(
          "Collection stopped on this page. Link revocation and any previous delivery could not be confirmed. Check with your organisation; the link expires automatically.",
        );
    }
  }
  return (
    <main className="hosted-page">
      <header className="hosted-page-header">
        <div className="brand">
          <span className="brand-mark">
            <Search className="icon" />
          </span>
          Identity Lens
        </div>
        <button className="text-link" onClick={onOrganisation}>
          <ArrowLeft className="icon" /> Organisation workspace
        </button>
      </header>
      <div className="hosted-page-intro">
        <div className="eyebrow">Hosted applicant activity</div>
        <h1>A clear record of this interaction.</h1>
        <p>
          {info
            ? `${info.organisationName} has invited applicant ${info.externalId} to complete a short activity on Identity Lens.`
            : error
              ? "This activity link could not be opened. Contact your organisation for a new invitation."
              : "Checking your activity link…"}
        </p>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {stage === "received" ? (
        <section className="panel hosted-complete">
          <CheckCircle2 size={40} />
          <h2>Activity received</h2>
          <p>
            Your organisation can inspect the interaction summary. This page
            does not reveal an internal risk assessment or make an approval
            decision.
          </p>
          <p className="small muted">
            Collection has stopped. No further activity is measured.
          </p>
          <button className="btn" onClick={onOrganisation}>
            Return to Identity Lens
          </button>
        </section>
      ) : stage === "stopped" ? (
        <section className="panel hosted-complete">
          <ShieldCheck size={40} />
          <h2>Collection stopped</h2>
          <p>
            No further activity is measured on this page. Any previously
            delivered summary and your organisation's existing applicant record
            are retained.
          </p>
          <button className="btn" onClick={onOrganisation}>
            Return to Identity Lens
          </button>
        </section>
      ) : (
        <div className="hosted-page-grid">
          <aside className="panel org-settings-panel">
            <div className="eyebrow">Before you start</div>
            <h2>Your activity notice</h2>
            <p>
              This page works with a fictional applicant record. After you
              acknowledge this notice, it measures:
            </p>
            <ul className="org-guidance">
              <li>Time spent on the active form in this page.</li>
              <li>
                How many non-sensitive fields change—not their selected or typed
                values.
              </li>
              <li>
                A first-party browser-storage token scoped to this organisation.
              </li>
            </ul>
            <p>
              On completion, only that summary is sent to Identity Lens for your
              organisation's investigation. You can stop without submitting it.
              Reloading restarts the page's measurement; it does not extend the
              link expiry.
            </p>
            <p className="small muted">
              No passwords, OTPs, IP addresses, GPS or other-site activity is
              collected. The browser token is resettable, not a verified
              person/device. Client-reported activity does not establish fraud.
              A notice acknowledgement is recorded; it is not a claim of a
              production privacy-compliance programme.
            </p>
            {info && (
              <p className="small">
                <Timer className="icon" /> Link expires {when(info.expiresAt)}
              </p>
            )}
            {stage === "notice" && (
              <>
                <label className="hosted-ack">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  I acknowledge the activity notice and confirm this is a
                  fictional applicant.
                </label>
                <button
                  className="btn primary"
                  disabled={!info || !acknowledged || busy}
                  onClick={start}
                >
                  {busy ? "Starting…" : "Start disclosed activity"}
                </button>
              </>
            )}
            {stage === "active" && (
              <>
                <p role="status" className="org-success">
                  Measuring this form only. No values are captured.
                </p>
                <button className="btn" disabled={busy} onClick={stop}>
                  Stop without submitting
                </button>
              </>
            )}
          </aside>
          <section className="panel org-settings-panel">
            <div className="eyebrow">Short account setup task</div>
            <h2>Complete this interaction</h2>
            <p className="muted">
              These choices let you interact with the form. Their values are not
              transmitted or stored; only duration and change count are
              submitted.
            </p>
            <form ref={form} onSubmit={finish}>
              <fieldset
                className="hosted-fields"
                disabled={stage !== "active" || busy}
              >
                <label>
                  Account purpose
                  <select aria-label="Account purpose" required defaultValue="">
                    <option value="">Choose a purpose</option>
                    <option value="learning">Learning</option>
                    <option value="project">Project work</option>
                    <option value="research">Research</option>
                  </select>
                </label>
                <label>
                  Preferred summary frequency
                  <select
                    aria-label="Preferred summary frequency"
                    required
                    defaultValue=""
                  >
                    <option value="">Choose a frequency</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label>
                  Workspace layout
                  <select
                    aria-label="Workspace layout"
                    required
                    defaultValue=""
                  >
                    <option value="">Choose a layout</option>
                    <option value="compact">Compact</option>
                    <option value="comfortable">Comfortable</option>
                  </select>
                </label>
                <button className="btn primary" type="submit">
                  {busy ? "Submitting…" : "Complete and submit activity"}
                </button>
              </fieldset>
            </form>
            <p className="small muted">
              Completing this task records one interaction summary. It does not
              open a financial account, verify an identity or guarantee
              authenticity.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
