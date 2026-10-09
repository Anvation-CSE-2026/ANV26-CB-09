export type Band = "Low" | "Review" | "High";
export type View = "workspace" | "compare" | "method";
export interface Group {
  key: string;
  label: string;
  cap: number;
  score: number;
  raw: number;
}
export interface Indicator {
  sourceRecords?: Record<string, unknown>[];
  id: string;
  group: string;
  title: string;
  points: number;
  observed: string;
  reason: string;
  context: string;
}
export interface Identity {
  id: string;
  displayName: string;
  declaredRegion: string;
  createdAt: string;
  emailCreatedAt: string;
  phoneVerified: boolean;
  addressToken: string;
  phoneToken: string;
  emulatedDevice: boolean;
  deviceIntegrityMismatch: boolean;
  deviceAttributes: {
    reportedPlatform: string;
    browserPlatform: string;
    environment: string;
  };
  profileRecords: {
    source: string;
    birthYear: number;
    declaredRegion: string;
  }[];
  events: {
    id: string;
    timestamp: string;
    deviceId: string;
    region: string;
    ipToken: string;
    formSeconds: number;
    editCount: number;
    failedAttempts: number;
  }[];
}
export interface Assessment {
  id: string;
  score: number;
  band: Band;
  groups: Group[];
  indicators: Indicator[];
  mitigations: { title: string; evidence: string }[];
  links: { type: string; label: string; value: string; peers: string[] }[];
  summary: {
    formSeconds: number;
    editCount: number;
    failedAttempts: number;
    sessionCount: number;
    mismatchRate: number;
    devices: string[];
  };
  explanation: string;
  version: string;
  excluded: string[];
}
export interface User {
  id: string;
  name: string;
  role: "analyst" | "admin" | "viewer";
}
export type ReviewStatus =
  "Unreviewed" | "In review" | "Needs evidence" | "Review complete";
export interface Review {
  identityId: string;
  status: ReviewStatus;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  notes: { id: number; text: string; author: string; createdAt: string }[];
  history: {
    id: number;
    actor: string;
    action: string;
    details: {
      status?: string;
      version?: string;
      score?: number;
      revision?: number;
    };
    createdAt: string;
  }[];
}
export interface Metrics {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  n: number;
  reviewCount: number;
}
export interface Bootstrap {
  population: Identity[];
  assessments: Assessment[];
  baseline: {
    n: number;
    formSeconds: { median: number; mad: number };
    editCount: { median: number; mad: number };
  };
  metrics: Metrics;
  groups: Group[];
  modelVersion: string;
  asOf: string;
  seed: number;
  showcases: string[];
  referenceCount: number;
  holdoutCount: number;
  reviews: Record<string, { status: ReviewStatus; revision: number }>;
  user: User;
  syntheticOnly: boolean;
}
