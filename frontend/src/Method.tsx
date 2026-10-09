import type { Bootstrap } from "./types";
import { download } from "./api";
const rules = [
  [
    "Identity",
    "Email age at registration",
    "Under 7 days: 7; under 30: 4",
    "4–7",
  ],
  [
    "Identity",
    "Profile consistency",
    "9 per conflicting attribute, at most 18",
    "9–18",
  ],
  ["Identity", "Contact verification", "No completed phone verification", "5"],
  [
    "Device",
    "Fingerprint reuse",
    "2 identities: 3; 3–4: 6; 5 or more: 10",
    "3–10",
  ],
  ["Device", "Emulated environment", "Emulation flag present", "8"],
  ["Device", "Attribute consistency", "Platform / browser conflict", "9"],
  ["Behaviour", "Region mismatch", "≥35% sessions: 4; ≥70%: 7", "4–7"],
  ["Behaviour", "Failed sign-ins", "≥4 failures: 4; ≥12: 7", "4–7"],
  ["Behaviour", "Registration burst", "≥3 in 30 min: 6; ≥5: 10", "6–10"],
  ["Behaviour", "Robust anomaly", "Distance ≥2.5: 6; ≥4: 10", "6–10"],
  [
    "Relationship",
    "Recovery contact reuse",
    "2 identities: 4; 3: 8; ≥4: 12",
    "4–12",
  ],
  ["Relationship", "Address reuse", "≥4 identities: 5; ≥6: 8", "5–8"],
];
export function Method({ data }: { data: Bootstrap }) {
  const m = data.metrics,
    b = data.baseline,
    percent = (n: number) => (n * 100).toFixed(1) + "%";
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Transparent assessment</div>
          <h1>Every score has a traceable reason.</h1>
          <p>
            Inspect the scoring policy, reference cohort and separate
            synthetic evaluation.
          </p>
        </div>
        <button
          className="btn"
          onClick={() =>
            download("identity-lens-validation.json", {
              modelVersion: data.modelVersion,
              syntheticOnly: true,
              threshold: 60,
              metrics: m,
              baseline: b,
              holdoutSeed: 9021,
              limitations:
                "Synthetic generator and policy share assumptions. No real-world performance or calibrated fraud probability is claimed.",
            })
          }
        >
          Export validation
        </button>
      </div>
      <div className="method-grid">
        <section className="panel method-panel">
          <div className="eyebrow">Scoring policy / v{data.modelVersion}</div>
          <h2>Four categories. One bounded risk index.</h2>
          <p>
            Each triggered indicator adds its documented weight. Each category
            is capped before the four category scores are summed. A score of 100
            means the policy’s maximum index, not a 100% fraud probability.
          </p>
          <dl className="profile-grid">
            {data.groups.map((g) => (
              <div className="profile-item" key={g.key}>
                <dt>{g.label}</dt>
                <dd>Maximum {g.cap} points</dd>
              </div>
            ))}
          </dl>
          <p>
            <strong>Low:</strong> 0–24 &nbsp; <strong>Review:</strong> 25–59
            &nbsp; <strong>High:</strong> 60–100
          </p>
          <h3>Behavioural anomaly detection</h3>
          <p>
            Mean form-completion time and mean field-edit count are compared
            with a separate cohort of {b.n} ordinary synthetic identities.
            For each feature, distance = |value − median| ÷ max(minimum scale,
            1.4826 × median absolute deviation). The larger feature distance is
            used. Minimum scales are 15 seconds and 1 field edit.
          </p>
          <p>
            Reference median:{" "}
            <strong>{b.formSeconds.median.toFixed(1)} seconds</strong> and{" "}
            <strong>{b.editCount.median.toFixed(2)} edits</strong>. No
            evaluation cases are used to fit this reference.
          </p>
          <h3>Relationship analysis</h3>
          <p>
            Exact synthetic device fingerprints, recovery-phone tokens and
            address tokens connect identities. Registrations using shared
            devices are checked with a sliding 30-minute window. Related
            identities’ risk scores are shown for investigation and never fed
            into the selected identity’s score.
          </p>
        </section>
        <section className="panel method-panel">
          <div className="eyebrow">Separate synthetic evaluation</div>
          <h2>Measured against {m.n} evaluation cases.</h2>
          <p>
            Seed 9021 · {m.tp + m.fn} suspicious scenarios · {m.tn + m.fp}{" "}
            legitimate or ambiguous scenarios. The high-risk threshold (60) is
            evaluated as a binary flag. Review cases count as unflagged.
          </p>
          <div className="metric-grid">
            {[
              [m.precision, "Precision"],
              [m.recall, "Recall"],
              [m.falsePositiveRate, "False-positive rate"],
            ].map(([n, label]) => (
              <div key={String(label)}>
                <div className="metric-number">{percent(Number(n))}</div>
                <div className="small">{label}</div>
              </div>
            ))}
          </div>
          <div className="matrix">
            {[
              [m.tp, "Suspicious cases flagged"],
              [m.fp, "Other cases flagged"],
              [m.fn, "Suspicious cases missed"],
              [m.tn, "Other cases unflagged"],
            ].map(([n, label]) => (
              <div key={String(label)}>
                <strong>{n}</strong>
                {label}
              </div>
            ))}
          </div>
          <p>
            {m.reviewCount} identities fall into the review band. Ambiguous
            scenarios are not assigned definitive fraud labels.
          </p>
          <h3>What the misses tell us</h3>
          <p>
            The generator includes isolated suspicious identities with few
            observable warning signs. These can evade a threshold-based
            assessment. Lack of links or consistency failures does not establish
            legitimacy.
          </p>
          <h3>Limits of this measurement</h3>
          <p>
            The generator and scoring policy share assumptions. Different seeds
            test repeatability, not real-world generalisation. These figures do
            not establish production KYC performance.
          </p>
        </section>
      </div>
      <section className="panel method-panel method-wide">
        <h2>Indicator reference</h2>
        <p>
          Weights are an explicit evidence policy. Reports preserve raw
          weights and capped totals.
        </p>
        <div className="overflow-x-auto">
          <table className="rule-table">
            <thead>
              <tr>
                {["Category", "Indicator", "Trigger", "Raw points"].map((t) => (
                  <th scope="col" key={t}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((row) => (
                <tr key={row[1]}>
                  {row.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel method-panel method-wide">
        <h2>Problem statement coverage</h2>
        <ol className="method-list">
          <li>
            <strong>Synthetic inputs only:</strong> {data.population.length}{" "}
            observed identities, {data.referenceCount} independent reference
            identities and {data.holdoutCount} holdout identities. No real
            personal data or external lookups.
          </li>
          <li>
            <strong>Identity, device and behaviour:</strong> profile
            consistency, email history, verification, device reuse, attributes,
            regions, registration timing and form behaviour.
          </li>
          <li>
            <strong>Three cases:</strong> legitimate, suspicious and ambiguous
            observations; truth labels remain outside the scorer.
          </li>
          <li>
            <strong>Explainable outputs:</strong> score breakdown, evidence,
            moderating observations, timeline, relationship graph and
            sensitivity analysis.
          </li>
          <li>
            <strong>Human review:</strong> findings prioritise investigation. No
            autonomous denial or production KYC decisions.
          </li>
        </ol>
      </section>
    </>
  );
}
