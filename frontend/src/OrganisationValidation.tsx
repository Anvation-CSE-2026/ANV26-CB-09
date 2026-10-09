import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api, download } from "./api";
interface Experiment {
  name: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  evaluated: number;
  precision: number | null;
  recall: number | null;
  falsePositiveRate: number | null;
}
interface Benchmark {
  policyVersion: string;
  referenceCount: number;
  cohortCount: number;
  knownLabelCount: number;
  ambiguousCount: number;
  threshold: number;
  experiments: Experiment[];
  ambiguousBands: Record<string, number>;
  method: string;
  limitations: string[];
}
const percent = (value: number | null) =>
  value === null ? "—" : `${(100 * value).toFixed(1)}%`;
export function OrganisationValidation() {
  const [data, setData] = useState<Benchmark | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Benchmark>("/org/validation")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            Inspect the scoring policy’s limitations
          </div>
          <h1>Method & validation</h1>
          <p>
            Measured comparisons on a separate synthetic cohort, with ambiguous
            cases reported independently.
          </p>
        </div>
        <button
          className="btn"
          disabled={!data}
          onClick={() =>
            download("identity-lens-synthetic-evaluation.json", data)
          }
        >
          <Download className="icon" />
          Export evaluation
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Evaluating synthetic cases…</p>}
      {data && (
        <>
          <div className="org-summary">
            <div>
              <span>Reference identities</span>
              <strong>{data.referenceCount}</strong>
            </div>
            <div>
              <span>Evaluation identities</span>
              <strong>{data.cohortCount}</strong>
            </div>
            <div>
              <span>Known synthetic labels</span>
              <strong>{data.knownLabelCount}</strong>
            </div>
            <div>
              <span>Ambiguous scenarios</span>
              <strong>{data.ambiguousCount}</strong>
            </div>
          </div>
          <section className="panel org-settings-panel">
            <h2>Baseline and scoring-group ablations</h2>
            <p>
              All experiments use the same evaluation observations. High-risk
              flags use a threshold of {data.threshold}. A dash means precision
              is undefined because no case was flagged.
            </p>
            <div className="org-table-scroll">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>Experiment</th>
                    <th>Precision</th>
                    <th>Recall</th>
                    <th>False-positive rate</th>
                    <th>Suspicious cases missed</th>
                    <th>Other cases flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {data.experiments.map((row) => (
                    <tr key={row.name}>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>{percent(row.precision)}</td>
                      <td>{percent(row.recall)}</td>
                      <td>{percent(row.falsePositiveRate)}</td>
                      <td>{row.fn}</td>
                      <td>{row.fp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel org-settings-panel">
            <h2>Ambiguity stays visible</h2>
            <p>
              Ambiguous generator scenarios are excluded from binary precision
              and recall. Their policy bands are:{" "}
              {Object.entries(data.ambiguousBands)
                .map(([band, count]) => `${band}: ${count}`)
                .join(", ")}
              .
            </p>
            <p>{data.method}</p>
            <h3>What these results cannot establish</h3>
            <ul className="org-guidance">
              {data.limitations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
            <p className="small muted">
              Synthetic policy version {data.policyVersion}. Scores express an
              evidence risk index, not fraud probabilities. Scoring runs on the
              backend; no trained neural model is used.
            </p>
          </section>
        </>
      )}
    </>
  );
}
