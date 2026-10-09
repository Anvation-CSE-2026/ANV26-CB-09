import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

export type Region = "North" | "South" | "East" | "West" | null;
export interface EvidenceProfile {
  source: string;
  birth_year: number | null;
  region: Region;
}
export interface EvidenceSession {
  event_id: string;
  timestamp: string;
  device_token: string;
  region: Region;
  form_seconds: number | null;
  edit_count: number | null;
  failed_attempts: number | null;
}
export interface EvidenceDraft {
  synthetic: true;
  external_id: string;
  registered_at: string;
  declared_region: Region;
  email_created_at: string | null;
  phone_verified: boolean | null;
  phone_token: string | null;
  address_token: string | null;
  emulated_device: boolean | null;
  device_mismatch: boolean | null;
  profile_records: EvidenceProfile[];
  sessions: EvidenceSession[];
}
export function emptyEvidence(): EvidenceDraft {
  return {
    synthetic: true,
    external_id: "",
    registered_at: new Date().toISOString(),
    declared_region: null,
    email_created_at: null,
    phone_verified: null,
    phone_token: null,
    address_token: null,
    emulated_device: null,
    device_mismatch: null,
    profile_records: [],
    sessions: [],
  };
}
export function evidenceDraft(record: Record<string, unknown>): EvidenceDraft {
  return { ...emptyEvidence(), ...record } as EvidenceDraft;
}
export function localTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, -1);
}
function instant(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
function number(value: string): number | null {
  return value === "" ? null : Number(value);
}
function RegionField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Region;
  onChange: (r: Region) => void;
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value || ""}
        onChange={(e) => onChange((e.target.value || null) as Region)}
      >
        <option value="">Unknown / not supplied</option>
        {["North", "South", "East", "West"].map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
    </label>
  );
}
function Flag({
  label,
  value,
  onChange,
  yes = "Yes",
  no = "No",
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  yes?: string;
  no?: string;
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value == null ? "" : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : e.target.value === "true")
        }
      >
        <option value="">Unknown / not supplied</option>
        <option value="true">{yes}</option>
        <option value="false">{no}</option>
      </select>
    </label>
  );
}
export function EvidenceModal({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="org-modal org-native-modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="section-title">
        <h2>{title}</h2>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function EvidenceEditor({
  value,
  onChange,
  lockedId = false,
  disabled = false,
}: {
  value: EvidenceDraft;
  onChange: (v: EvidenceDraft) => void;
  lockedId?: boolean;
  disabled?: boolean;
}) {
  const set = <K extends keyof EvidenceDraft>(key: K, next: EvidenceDraft[K]) =>
    onChange({ ...value, [key]: next });
  const profile = (index: number, next: Partial<EvidenceProfile>) =>
    set(
      "profile_records",
      value.profile_records.map((r, i) =>
        i === index ? { ...r, ...next } : r,
      ),
    );
  const session = (index: number, next: Partial<EvidenceSession>) =>
    set(
      "sessions",
      value.sessions.map((r, i) => (i === index ? { ...r, ...next } : r)),
    );
  return (
    <fieldset disabled={disabled} className="org-evidence-editor">
      <p className="org-form-notice">
        Fictional applicants only. Leave unavailable observations unknown.
        Supplied verification and device flags are not independently verified by
        Identity Lens. Times use your browser’s local timezone and are saved in
        UTC.
      </p>
      <section>
        <h3>Registration record</h3>
        <div className="org-form-row">
          <label>
            Applicant ID
            <input
              required
              pattern="[A-Za-z0-9._\-]+"
              maxLength={64}
              readOnly={lockedId}
              placeholder="APP-001"
              value={value.external_id}
              onChange={(e) => set("external_id", e.target.value)}
            />
          </label>
          <label>
            Registered at
            <input
              type="datetime-local"
              step="0.001"
              required
              value={localTime(value.registered_at)}
              onChange={(e) =>
                set("registered_at", instant(e.target.value) || "")
              }
            />
          </label>
        </div>
        <RegionField
          label="Declared region"
          value={value.declared_region}
          onChange={(r) => set("declared_region", r)}
        />
      </section>
      <section>
        <h3>Identity and contact evidence</h3>
        <div className="org-form-row">
          <label>
            Email created at
            <input
              type="datetime-local"
              step="0.001"
              value={localTime(value.email_created_at)}
              max={localTime(value.registered_at)}
              onChange={(e) => set("email_created_at", instant(e.target.value))}
            />
            <span className="small muted">
              Supplied creation timestamp—not an email address.
            </span>
          </label>
          <Flag
            label="Phone verification"
            value={value.phone_verified}
            onChange={(v) => set("phone_verified", v)}
            yes="Verified in supplied evidence"
            no="Not verified in supplied evidence"
          />
          <label>
            Phone token
            <input
              pattern="PHONE-[A-Z0-9\-]+"
              maxLength={86}
              placeholder="PHONE-FICTIONAL-001"
              value={value.phone_token || ""}
              onChange={(e) => set("phone_token", e.target.value || null)}
            />
          </label>
          <label>
            Address token
            <input
              pattern="ADDR-[A-Z0-9\-]+"
              maxLength={85}
              placeholder="ADDR-FICTIONAL-001"
              value={value.address_token || ""}
              onChange={(e) => set("address_token", e.target.value || null)}
            />
          </label>
        </div>
      </section>
      <section>
        <div className="section-title">
          <div>
            <h3>Profile source records</h3>
            <p className="small muted">
              Compare supplied records. Adding an empty record does not
              establish consistency.
            </p>
          </div>
          <button
            type="button"
            className="btn"
            disabled={value.profile_records.length >= 10}
            onClick={() =>
              set("profile_records", [
                ...value.profile_records,
                { source: "", birth_year: null, region: null },
              ])
            }
          >
            <Plus className="icon" />
            Add profile record
          </button>
        </div>
        {value.profile_records.map((r, i) => (
          <div key={i} className="org-record-editor">
            <div className="section-title">
              <strong>Profile record {i + 1}</strong>
              <button
                className="btn subtle"
                type="button"
                aria-label={`Remove profile record ${i + 1}`}
                onClick={() =>
                  set(
                    "profile_records",
                    value.profile_records.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 className="icon" />
              </button>
            </div>
            <label>
              Source · record {i + 1}
              <input
                required
                minLength={2}
                maxLength={80}
                value={r.source}
                onChange={(e) => profile(i, { source: e.target.value })}
                placeholder="Synthetic registration record"
              />
            </label>
            <div className="org-form-row">
              <label>
                Birth year · record {i + 1}
                <input
                  type="number"
                  min={1900}
                  max={2026}
                  step={1}
                  placeholder="Unknown"
                  value={r.birth_year ?? ""}
                  onChange={(e) =>
                    profile(i, { birth_year: number(e.target.value) })
                  }
                />
              </label>
              <RegionField
                label={`Region · record ${i + 1}`}
                value={r.region}
                onChange={(region) => profile(i, { region })}
              />
            </div>
          </div>
        ))}
      </section>
      <section>
        <h3>Supplied device checks</h3>
        <div className="org-form-row">
          <Flag
            label="Emulated environment"
            value={value.emulated_device}
            onChange={(v) => set("emulated_device", v)}
          />
          <Flag
            label="Device attribute mismatch"
            value={value.device_mismatch}
            onChange={(v) => set("device_mismatch", v)}
          />
        </div>
      </section>
      <section>
        <div className="section-title">
          <div>
            <h3>Session observations</h3>
            <p className="small muted">
              No sessions means Pending. Duration, changes and failures are
              supplied observations, not measurements taken by this form.
            </p>
          </div>
          <button
            type="button"
            className="btn"
            disabled={value.sessions.length >= 100}
            onClick={() =>
              set("sessions", [
                ...value.sessions,
                {
                  event_id:
                    "EVENT-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
                  timestamp: value.registered_at || new Date().toISOString(),
                  device_token: "",
                  region: null,
                  form_seconds: null,
                  edit_count: null,
                  failed_attempts: null,
                },
              ])
            }
          >
            <Plus className="icon" />
            Add session
          </button>
        </div>
        {value.sessions.map((r, i) => (
          <details className="org-record-editor" key={i} open>
            <summary>
              Session {i + 1}: {r.event_id}
            </summary>
            <div className="org-form-row">
              <label>
                Event ID · session {i + 1}
                <input
                  required
                  pattern="[A-Za-z0-9._\-]+"
                  maxLength={64}
                  value={r.event_id}
                  onChange={(e) => session(i, { event_id: e.target.value })}
                />
              </label>
              <label>
                Observed at · session {i + 1}
                <input
                  type="datetime-local"
                  required
                  step="0.001"
                  min={localTime(value.registered_at)}
                  value={localTime(r.timestamp)}
                  onChange={(e) =>
                    session(i, { timestamp: instant(e.target.value) || "" })
                  }
                />
              </label>
              <label>
                Device token · session {i + 1}
                <input
                  required
                  pattern="DEV-[A-Z0-9\-]+"
                  maxLength={84}
                  placeholder="DEV-FICTIONAL-001"
                  value={r.device_token}
                  onChange={(e) => session(i, { device_token: e.target.value })}
                />
              </label>
              <RegionField
                label={`Observed region · session ${i + 1}`}
                value={r.region}
                onChange={(region) => session(i, { region })}
              />
              <label>
                Form duration (seconds) · session {i + 1}
                <input
                  type="number"
                  min={0}
                  max={1800}
                  step="any"
                  placeholder="Unknown"
                  value={r.form_seconds ?? ""}
                  onChange={(e) =>
                    session(i, { form_seconds: number(e.target.value) })
                  }
                />
              </label>
              <label>
                Field changes · session {i + 1}
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  placeholder="Unknown"
                  value={r.edit_count ?? ""}
                  onChange={(e) =>
                    session(i, { edit_count: number(e.target.value) })
                  }
                />
              </label>
              <label>
                Failed sign-ins · session {i + 1}
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  placeholder="Unknown"
                  value={r.failed_attempts ?? ""}
                  onChange={(e) =>
                    session(i, { failed_attempts: number(e.target.value) })
                  }
                />
              </label>
            </div>
            <button
              className="btn subtle"
              type="button"
              onClick={() =>
                set(
                  "sessions",
                  value.sessions.filter((_, j) => j !== i),
                )
              }
            >
              Remove session {i + 1}
            </button>
          </details>
        ))}
      </section>
      <details>
        <summary>Inspect the generated evidence record</summary>
        <pre className="org-code">{JSON.stringify(value, null, 2)}</pre>
      </details>
    </fieldset>
  );
}
