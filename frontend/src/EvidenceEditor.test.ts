import { describe, it, expect } from "vitest";
import { emptyEvidence, evidenceDraft, localTime } from "./EvidenceEditor";

describe("structured evidence drafts", () => {
  it("does not invent verification, profile sources or observations", () => {
    const d = emptyEvidence();
    expect(d.synthetic).toBe(true);
    expect(d.phone_verified).toBeNull();
    expect(d.emulated_device).toBeNull();
    expect(d.profile_records).toEqual([]);
    expect(d.sessions).toEqual([]);
  });
  it("preserves false values, unknown failures and exact instants during corrections", () => {
    const original = {
      registered_at: "2026-10-01T09:00:00.123Z",
      phone_verified: false,
      sessions: [{ failed_attempts: null }],
    };
    const d = evidenceDraft(original);
    expect(d.phone_verified).toBe(false);
    expect(d.sessions[0].failed_attempts).toBeNull();
    expect(new Date(localTime(d.registered_at)).toISOString()).toBe(
      original.registered_at,
    );
  });
  it("unknown or invalid instants remain empty", () => {
    expect(localTime(null)).toBe("");
    expect(localTime("not a date")).toBe("");
  });
});
