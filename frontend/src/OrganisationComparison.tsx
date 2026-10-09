import { useState } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import type { OrgCase } from "./org-types";

export function OrganisationComparison({
  cases,
  onBack,
  onSelect,
}: {
  cases: OrgCase[];
  onBack: () => void;
  onSelect: (id: string) => void;
}) {
  const initial: string[] = [];
  for (const band of ["Low", "Review", "High"]) {
    const candidate =
      cases.find(
        (c) => c.assessment.band === band && !initial.includes(c.id),
      ) || cases.find((c) => !initial.includes(c.id));
    initial.push(candidate?.id || "");
  }
  const [selection, setSelection] = useState(initial);
  return (
    <>
      <button className="btn org-back" onClick={onBack}>
        <ArrowLeft className="icon" />
        All applicants
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Understand why risk differs</div>
          <h1>Compare evidence</h1>
          <p>
            Choose up to three applicants from your organisation. Scores are
            advisory; each assessment remains independent.
          </p>
        </div>
      </div>
      <div className="org-comparison-grid">
        {selection.map((id, index) => {
          const row = cases.find((c) => c.id === id),
            assessment = row?.assessment;
          return (
            <section className="panel org-comparison-card" key={index}>
              <label className="org-comparison-select">
                Applicant {index + 1}
                <select
                  aria-label={`Comparison applicant ${index + 1}`}
                  value={id}
                  onChange={(e) =>
                    setSelection(
                      selection.map((s, i) =>
                        i === index ? e.target.value : s,
                      ),
                    )
                  }
                >
                  <option value="">Choose an applicant</option>
                  {cases.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={selection.includes(c.id) && c.id !== id}
                    >
                      {c.externalId}
                    </option>
                  ))}
                </select>
              </label>
              {row && assessment ? (
                <>
                  <div className="org-big-score">
                    {assessment.score ?? "—"}
                    <span>
                      {assessment.band === "Pending"
                        ? "Awaiting activity"
                        : "/ 100"}
                    </span>
                  </div>
                  <span className={`pill ${assessment.band}`}>
                    {assessment.band === "Review"
                      ? "Needs review"
                      : assessment.band +
                        (assessment.band === "Pending" ? "" : " risk")}
                  </span>
                  <h2>Why this assessment?</h2>
                  <p>{assessment.explanation}</p>
                  <h3>Contributing evidence</h3>
                  {assessment.indicators.length ? (
                    <ul className="org-comparison-signals">
                      {assessment.indicators.map((i) => (
                        <li key={i.id}>
                          <strong>{i.title}</strong>
                          <span>+{i.points} raw</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="small muted">
                      No configured indicator is triggered by available
                      observations. This does not establish authenticity.
                    </p>
                  )}
                  <h3>Capped group contributions</h3>
                  <dl className="org-comparison-groups">
                    {assessment.groups.map((g) => (
                      <div key={g.key}>
                        <dt>{g.label}</dt>
                        <dd>
                          {g.score} / {g.cap}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <h3>Evidence gaps</h3>
                  <p className="small">
                    {assessment.coverage.missing.join(", ") ||
                      "All configured input categories have observations."}
                  </p>
                  <h3>What could change this assessment?</h3>
                  <p className="small">
                    {assessment.band === "Pending"
                      ? "Sourced sessions would allow scoring. Missing inputs would still need investigation."
                      : assessment.band === "Low"
                        ? "New profile conflicts or corroborated coordinated activity could raise risk. Low observed risk is not verified authenticity."
                        : "Verified context and corrected source records could change the triggered indicators. Sharing alone does not prove fraud."}
                  </p>
                  <p className="small muted">
                    Use an investigation's what-if controls to measure changes,
                    or correct evidence with a documented reason.
                  </p>
                  <button className="btn" onClick={() => onSelect(row.id)}>
                    Inspect {row.externalId}
                    <ArrowUpRight className="icon" />
                  </button>
                </>
              ) : (
                <p className="muted">Select a case to compare its evidence.</p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
