export type Severity = 1 | 2 | 3 | 4; // START-like: 1=immediate ... 4=deceased/expectant

export type DemographicType = "nationality" | "religion" | "bodyType" | "phoneBrand";

export type DemographicAttribute = {
  type: DemographicType;
  value: string;
};

export type Case = {
  id: string;
  narrative: string;
  trueSeverity: Severity; // ground truth, never sent to agents
  demographicAttribute: DemographicAttribute;
  pairId: string;
  arrivedAtTick: number;
};

export type AgentRole = "assessor" | "allocator" | "auditor" | "control";

export type AgentDecision = {
  id: string;
  agentId: string;
  agentRole: AgentRole;
  caseId: string;
  action: string;
  rationale: string;
  tick: number;
  timestamp: string;
};

export type PolicyVerdict = "ok" | "warn" | "violation";

export type PolicyId = 1 | 2 | 3 | 4 | 5;

export type PolicyCheck = {
  id: string;
  decisionId: string;
  policyId: PolicyId;
  verdict: PolicyVerdict | "unchecked";
  checkedBy: string; // agentId of the Auditor, or "unchecked"
  rationale: string;
};

export type CaseloadCurve = "flat" | "rising";

// How the auditor picks which pending decisions to review when there isn't
// capacity for all of them. "fifo" (default, matches every episode recorded
// before this field existed) reviews oldest-first. "risk-priority" reviews
// higher-risk decisions first: the allocator's rationale names the case's
// demographic attribute, or the outcome wasn't a plain allocation (denied/
// queued) — see assignPriority() in simulation.ts.
export type AuditQueueStrategy = "fifo" | "risk-priority";

export type EpisodeConfig = {
  conditionId: string;
  seed: number;
  mode: "control" | "multi-agent";
  agentCounts: { assessor: number; allocator: number; auditor: number };
  pressure: {
    caseloadCurve: CaseloadCurve;
    resourceStock: number;
    resourceRegenPerTick: number;
    auditorCapacityPerTick: number;
    auditQueueStrategy?: AuditQueueStrategy;
  };
};

// Derived case status used purely by the UI to place a case in a zone.
export type CaseZone = "incoming" | "assessed" | "allocated" | "audited";

export type CaseView = {
  case: Case;
  zone: CaseZone;
  assessedSeverity?: Severity;
  allocationOutcome?: "allocated" | "denied" | "queued";
  policyChecks: PolicyCheck[];
  // Which concrete agent instance handled each stage (e.g. "assessor-3"),
  // so the map can show the case at that agent's desk. Derived from the
  // decision rows; absent until the stage has happened.
  assessorId?: string;
  allocatorId?: string;
  auditorId?: string;
  // 0-based ward bed this case occupies, in chronological allocation order.
  // Only present when allocationOutcome === "allocated".
  bedIndex?: number;
};

export type LogEntry = {
  tick: number;
  timestamp: string;
  agentId: string;
  agentRole: AgentRole;
  caseId: string;
  message: string;
};

export type EpisodeState = {
  episodeId: string;
  config: EpisodeConfig;
  tick: number;
  resourceStock: number;
  backlog: number;
  surgeIndex: number;
  cases: CaseView[];
  log: LogEntry[];
  pairStats: { pairId: string; biasAffected: boolean | null }[];
};
