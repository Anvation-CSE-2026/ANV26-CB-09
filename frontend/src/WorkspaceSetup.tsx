import { useEffect, useState } from "react";
import { CheckCircle2, Circle, ArrowUpRight } from "lucide-react";
import { api } from "./api";
import type { OrgCase, OrgUser } from "./org-types";
interface Setup {
  members: number;
  applicants: number;
  completedReviews: number;
  activeConnections: number;
  serverCasesReceived: number;
  openRequests: number;
  browserMeasurementEnabled: boolean;
  hostedActivityEnabled: boolean;
  hostedSummariesReceived: number;
}
export function WorkspaceSetup({
  cases,
  user,
  onNavigate,
}: {
  cases: OrgCase[];
  user: OrgUser;
  onNavigate: (
    page: "cases" | "imports" | "integrations" | "team" | "hosted",
  ) => void;
}) {
  const [data, setData] = useState<Setup | null>(null),
    [error, setError] = useState("");
  const signature = cases.map((c) => c.id + c.revision + c.status).join("|");
  useEffect(() => {
    let active = true;
    api<Setup>("/org/onboarding")
      .then((r) => {
        if (active) {
          setData(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [signature, user.organisationId]);
  if (error)
    return (
      <p role="alert" className="inline-error">
        Setup status unavailable: {error}
      </p>
    );
  if (!data)
    return (
      <p role="status" className="small muted">
        Checking workspace setup…
      </p>
    );
  const steps: {
    title: string;
    detail: string;
    done: boolean;
    optional?: boolean;
    page: "cases" | "imports" | "integrations" | "team" | "hosted";
  }[] = [
    {
      title: "Bring your first evidence",
      detail: data.applicants
        ? `${data.applicants} applicant records received`
        : "Import a fictional dataset or add an applicant",
      done: data.applicants > 0,
      page: "imports",
    },
    {
      title: "Invite your team",
      detail: `${data.members} active member${data.members === 1 ? "" : "s"}. Invitations are shared manually.`,
      done: data.members > 1,
      optional: true,
      page: "team",
    },
    ...(user.role === "admin"
      ? [
          {
            title: "Connect a registration backend",
            detail: data.serverCasesReceived
              ? `${data.serverCasesReceived} applicants received through a server key`
              : data.activeConnections
                ? "Key created; no applicant delivery confirmed yet"
                : "Create a private server key and submit evidence",
            done: data.serverCasesReceived > 0,
            optional: true,
            page: "integrations" as const,
          },
        ]
      : []),
    {
      title: "Collect hosted activity",
      detail: data.hostedSummariesReceived
        ? `${data.hostedSummariesReceived} interaction summaries received`
        : "Issue an expiring applicant link from this website",
      done: data.hostedSummariesReceived > 0,
      optional: true,
      page: "hosted",
    },
    {
      title: "Complete your first review",
      detail: data.completedReviews
        ? `${data.completedReviews} completed review${data.completedReviews === 1 ? "" : "s"}`
        : "Inspect evidence and record a human review",
      done: data.completedReviews > 0,
      page: "cases",
    },
  ];
  return (
    <section className="panel org-setup">
      <div className="section-title">
        <div>
          <div className="eyebrow">A clear start for your organisation</div>
          <h2>Workspace setup</h2>
        </div>
        <span className="small muted">
          {data.openRequests} open evidence requests
        </span>
      </div>
      <div className="org-setup-grid">
        {steps.map((step) => (
          <article key={step.title}>
            {step.done ? (
              <CheckCircle2 className="org-step-done" size={20} />
            ) : (
              <Circle size={20} className="muted" />
            )}
            <h3>{step.title}</h3>
            {step.optional && <span className="small muted">Optional</span>}
            <p>{step.detail}</p>
            <button className="text-link" onClick={() => onNavigate(step.page)}>
              {step.done ? "Open" : "Continue"}
              <ArrowUpRight className="icon" />
            </button>
          </article>
        ))}
      </div>
      <p className="small muted">
        Hosted activity is{" "}
        {data.hostedActivityEnabled
          ? "available after an applicant acknowledges the notice"
          : "disabled"}
        . External-site browser measurement is{" "}
        {data.browserMeasurementEnabled ? "enabled by configuration" : "off"}.
        Applicant identities remain fictional.
      </p>
    </section>
  );
}
