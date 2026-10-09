import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Review, ReviewStatus, User } from "./types";
const statuses: ReviewStatus[] = [
  "Unreviewed",
  "In review",
  "Needs evidence",
  "Review complete",
];
const sampleActor = (name: string) =>
  name === "Demo analyst"
    ? "Sample analyst"
    : name === "Demo viewer"
      ? "Sample viewer"
      : name;
export function ReviewPanel({
  id,
  user,
  onSaved,
}: {
  id: string;
  user: User;
  onSaved: (review: Review) => void;
}) {
  const [review, setReview] = useState<Review | null>(null),
    [status, setStatus] = useState<ReviewStatus>("Unreviewed"),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function load() {
    setError("");
    try {
      const r = await api<Review>(`/cases/${id}/review`);
      setReview(r);
      setStatus(r.status);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    setReview(null);
    setNote("");
    setSaved(false);
    setError("");
    api<Review>(`/cases/${id}/review`)
      .then((r) => {
        if (active) {
          setReview(r);
          setStatus(r.status);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!review) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const r = await api<Review>(`/cases/${id}/review`, {
        method: "PUT",
        body: JSON.stringify({ status, note, revision: review.revision }),
      });
      setReview(r);
      setStatus(r.status);
      setNote("");
      onSaved(r);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) setSaved(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="review-panel" aria-label="Analyst review">
      <div className="section-title">
        <div>
          <h3>Analyst review</h3>
          <p className="small muted">
            Record context, request evidence and keep a review trail.
          </p>
        </div>
        <span className="pill">{review?.status || "Loading"}</span>
      </div>
      {error && (
        <div role="alert" className="inline-error">
          {error}{" "}
          <button className="text-link" onClick={load}>
            Reload review
          </button>
        </div>
      )}
      {review && (
        <>
          <form onSubmit={save}>
            <div className="review-form">
              <label>
                Review status
                <select
                  aria-label="Review status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as ReviewStatus);
                    setSaved(false);
                  }}
                  disabled={user.role === "viewer" || busy}
                >
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Investigation note
                <textarea
                  aria-label="Investigation note"
                  maxLength={4000}
                  rows={3}
                  placeholder="What evidence did you inspect? What needs clarification?"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setSaved(false);
                  }}
                  disabled={user.role === "viewer" || busy}
                />
              </label>
            </div>
            <div className="review-actions">
              <span className="small muted">
                {user.role === "viewer"
                  ? "Your account has read-only access."
                  : "Review status does not change the evidence score or deny an applicant."}
              </span>
              <button
                className="btn primary"
                disabled={busy || user.role === "viewer"}
              >
                {busy ? "Saving…" : "Save review"}
              </button>
            </div>
            {saved && (
              <p className="save-confirmation" role="status">
                Review saved. It will remain available after refresh.
              </p>
            )}
          </form>
          <div className="review-notes">
            {review.notes.length > 0 && <h3>Investigation notes</h3>}
            {review.notes.map((n) => (
              <article className="saved-note" key={n.id}>
                <p>{n.text}</p>
                <div className="small muted">
                  {sampleActor(n.author)} ·{" "}
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </article>
            ))}
          </div>
          {review.history.length > 0 && (
            <details className="review-history">
              <summary>
                Review history · {review.history.length} recent events
              </summary>
              {review.history.map((a) => (
                <div className="audit-event" key={a.id}>
                  <strong>
                    {a.action === "review_saved"
                      ? a.details.status
                      : a.action === "synthetic_case_created"
                        ? "Synthetic case created"
                        : "Assessment recalculated"}
                  </strong>
                  <span className="small muted">
                    {sampleActor(a.actor)} ·{" "}
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
