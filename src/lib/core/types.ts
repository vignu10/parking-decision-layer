import type { Answers } from "../jev/types";

export type Route = "AUTO" | "REVIEW" | "HUMAN" | "BLOCKED";
export type Workflow = "support" | "agent_guard";

export type ActionKind =
  | "page_security_lead"
  | "assign_duty_manager"
  | "assign_front_desk"
  | "queue_refund"
  | "prepare_waiver"
  | "open_barrier"
  | "notify_technician"
  | "send_template"
  | "resync_pass"
  | "execute_agent_action"
  | "block_agent_action";

export interface PlannedAction {
  kind: ActionKind;
  label: string;
  /** "now": runs as soon as the decision is made. "on_approval": runs only after a person approves. */
  when: "now" | "on_approval";
  params?: Record<string, unknown>;
}

export type DecisionStatus =
  | "executed" // AUTO actions ran
  | "pending_approval" // REVIEW, waiting for staff
  | "assigned" // HUMAN, with a person
  | "blocked" // agent guard refused
  | "shadow" // shadow mode: logged only
  | "approved"
  | "rejected"
  | "handled";

export interface Gate {
  /** Minimum confidence across the gating questions (F-2). null when Jev was not called / failed. */
  confidence: number | null;
  /** The question that set the minimum. */
  weakest: string | null;
  questions: string[];
}

export interface Decision {
  id: string;
  workflow: Workflow;
  createdAt: string;
  /** Short human-readable summary of the item. */
  title: string;
  /** Text actually sent to Jev (after redaction). */
  state: string;
  redactions: number;
  answers: Answers | null;
  gate: Gate;
  route: Route;
  /** Hard rule that fired, if any (e.g. "HR-1 Safety"). */
  rule: string | null;
  reason: string;
  actions: PlannedAction[];
  status: DecisionStatus;
  urgent: boolean;
  category: string | null;
  shadow: boolean;
  provider: string;
  latencyMs: number;
  inputTokens: number;
  costUsd: number;
  error: string | null;
  resolvedBy?: string;
  resolvedAt?: string;
}

/** What a workflow's rules return; the engine fills in the rest. */
export interface Verdict {
  route: Route;
  rule: string | null;
  reason: string;
  actions: PlannedAction[];
  gate: Gate;
  urgent: boolean;
  category: string | null;
}

export type AuditType = "decision" | "action" | "approval" | "rejection" | "handled" | "config_change" | "error";

export interface AuditEvent {
  seq: number;
  ts: string;
  type: AuditType;
  workflow?: Workflow;
  decisionId?: string;
  route?: Route;
  confidence?: number | null;
  rule?: string | null;
  reason: string;
  actor: string;
  shadow?: boolean;
  detail?: Record<string, unknown>;
}
