import type { Assessment } from "./types";
export interface OrgUser {
  id: string;
  name: string;
  username: string;
  role: "admin" | "analyst" | "viewer";
  organisationId: string;
  organisationName: string;
}
export interface Coverage {
  percent: number;
  available: string[];
  missing: string[];
  status: string;
  isConfidence: boolean;
}
export type OrgAssessment = Omit<Assessment, "score" | "band"> & {
  score: number | null;
  band: "Low" | "Review" | "High" | "Pending";
  coverage: Coverage;
  referenceVersion: string;
  evidenceRevision: number;
};
export interface OrgCase {
  id: string;
  externalId: string;
  revision: number;
  status: string;
  assignedTo: string | null;
  createdAt: string;
  assessment: OrgAssessment;
}
export interface TeamMember {
  id: string;
  name: string;
  username: string;
  role: string;
  active: boolean;
}
export interface AuditItem {
  id: number;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  timestamp: string;
  caseId?: string;
}
export interface CaseDetail extends Omit<OrgCase, "createdAt"> {
  evidenceRevision: number;
  evidence: Record<string, unknown>;
  identity: import("./types").Identity;
  history: {
    id: number;
    score: number | null;
    band: string;
    evidenceRevision: number;
    policyVersion: string;
    timestamp: string;
  }[];
  events: {
    id: string;
    source: string;
    receivedAt: string;
    payload: Record<string, unknown>;
  }[];
  audit: AuditItem[];
}
export function readable(value: string) {
  return value.replaceAll("_", " ");
}
export function when(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
