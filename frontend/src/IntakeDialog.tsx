import { useEffect, useRef, useState } from "react";
import { X, Plus } from "lucide-react";
import { api } from "./api";
import type { Identity } from "./types";
type Region = "North" | "South" | "East" | "West";
interface CaseInput {
  registration_time: string;
  email_age_days: number;
  region: Region;
  verification_region: Region;
  birth_year: number;
  verification_birth_year: number;
  phone_verified: boolean;
  emulated_device: boolean;
  device_mismatch: boolean;
  device_token: string;
  address_token: string;
  phone_token: string;
  session_region: Region;
  form_seconds: number;
  edit_count: number;
  failed_attempts: number;
  session_count: number;
}
const regions: Region[] = ["North", "South", "East", "West"];
export function IntakeDialog({
  population,
  onClose,
  onCreated,
}: {
  population: Identity[];
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState<CaseInput>(() => {
    const token = crypto.randomUUID().slice(0, 8).toUpperCase();
    return {
      registration_time: new Date().toISOString().slice(0, 16),
      email_age_days: 180,
      region: "North",
      verification_region: "North",
      birth_year: 1995,
      verification_birth_year: 1995,
      phone_verified: true,
      emulated_device: false,
      device_mismatch: false,
      device_token: `DEV-NEW-${token}`,
      address_token: `ADDR-NEW-${token}`,
      phone_token: `PHONE-NEW-${token}`,
      session_region: "North",
      form_seconds: 180,
      edit_count: 4,
      failed_attempts: 0,
      session_count: 3,
    };
  });
  useEffect(() => {
    const element = dialog.current!;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);
  function set<K extends keyof CaseInput>(key: K, value: CaseInput[K]) {
    setForm((old) => ({ ...old, [key]: value }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        registration_time: new Date(form.registration_time + "Z").toISOString(),
      };
      const result = await api<{ identity: Identity }>("/cases", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await onCreated(result.identity.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const number = (
    key:
      | "email_age_days"
      | "birth_year"
      | "verification_birth_year"
      | "session_count"
      | "form_seconds"
      | "edit_count"
      | "failed_attempts",
    label: string,
    min: number,
    max: number,
  ) => (
    <label>
      {label}
      <input
        type="number"
        required
        min={min}
        max={max}
        value={Number(form[key])}
        disabled={busy}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </label>
  );
  const region = (
    key: "region" | "verification_region" | "session_region",
    label: string,
  ) => (
    <label>
      {label}
      <select
        value={form[key]}
        disabled={busy}
        onChange={(e) => set(key, e.target.value as Region)}
      >
        {regions.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="intake-dialog"
      aria-labelledby="intake-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="intake-heading">
        <div>
          <div className="eyebrow">Synthetic evidence only</div>
          <h2 id="intake-title">Add a synthetic case</h2>
        </div>
        <button
          type="button"
          className="btn subtle"
          aria-label="Close case form"
          disabled={busy}
          onClick={onClose}
        >
          <X className="icon" />
        </button>
      </div>
      <p className="small muted">
        Use invented tokens only. Applicant names are generated automatically.
        Shared tokens will link to existing cases.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <legend>Identity evidence</legend>
          <div className="intake-grid">
            <label>
              Registration time (UTC)
              <input
                type="datetime-local"
                required
                value={form.registration_time}
                onChange={(e) => set("registration_time", e.target.value)}
              />
            </label>
            {number(
              "email_age_days",
              "Email age at registration (days)",
              0,
              3000,
            )}
            {number("birth_year", "Registration birth year", 1900, 2020)}
            {number(
              "verification_birth_year",
              "Verification birth year",
              1900,
              2020,
            )}
            {region("region", "Declared region")}
            {region("verification_region", "Verification region")}
          </div>
          <label className="intake-check">
            <input
              type="checkbox"
              checked={form.phone_verified}
              onChange={(e) => set("phone_verified", e.target.checked)}
            />
            Phone verification completed
          </label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Device and shared tokens</legend>
          <div className="intake-grid">
            {(["device_token", "phone_token", "address_token"] as const).map(
              (key) => (
                <label key={key}>
                  {key === "device_token"
                    ? "Device token"
                    : key === "phone_token"
                      ? "Recovery phone token"
                      : "Address token"}
                  <input
                    required
                    pattern={
                      key === "device_token"
                        ? "DEV-[A-Z0-9-]{1,80}"
                        : key === "phone_token"
                          ? "PHONE-[A-Z0-9-]{1,80}"
                          : "ADDR-[A-Z0-9-]{1,80}"
                    }
                    maxLength={90}
                    list={`tokens-${key}`}
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value.toUpperCase())}
                  />
                  <datalist id={`tokens-${key}`}>
                    {[
                      ...new Set(
                        population.flatMap((p) =>
                          key === "device_token"
                            ? p.events.map((e) => e.deviceId)
                            : [
                                key === "phone_token"
                                  ? p.phoneToken
                                  : p.addressToken,
                              ],
                        ),
                      ),
                    ].map((token) => (
                      <option key={token} value={token} />
                    ))}
                  </datalist>
                </label>
              ),
            )}
          </div>
          <div className="intake-checks">
            <label className="intake-check">
              <input
                type="checkbox"
                checked={form.emulated_device}
                onChange={(e) => set("emulated_device", e.target.checked)}
              />
              Emulated environment
            </label>
            <label className="intake-check">
              <input
                type="checkbox"
                checked={form.device_mismatch}
                onChange={(e) => set("device_mismatch", e.target.checked)}
              />
              Conflicting platform attributes
            </label>
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Behavioural observations</legend>
          <div className="intake-grid">
            {region("session_region", "Observed session region")}
            {number("session_count", "Number of sessions", 1, 20)}
            {number(
              "form_seconds",
              "Form completion per session (seconds)",
              1,
              1800,
            )}
            {number("edit_count", "Field edits per session", 0, 200)}
            {number("failed_attempts", "Failed sign-ins per session", 0, 100)}
          </div>
        </fieldset>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="intake-footer">
          <p className="small muted">
            New evidence will trigger fresh assessments for the observed
            population. Existing notes remain intact.
          </p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            <Plus className="icon" />
            {busy ? "Saving & assessing…" : "Create and assess"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
