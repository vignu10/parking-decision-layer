import { appendAudit } from "../core/store";
import type { Decision, PlannedAction } from "../core/types";

/**
 * Dummy integrations. Each one only records what it would have done.
 * Replace the bodies with real helpdesk / payment gateway / gate controller / pager / pass-service
 * calls, using least-privilege service accounts (NFR security).
 */
export type Executor = (action: PlannedAction, d: Decision) => Promise<string>;

const fake =
  (system: string, verb: (a: PlannedAction) => string): Executor =>
  async (a) => {
    await new Promise((r) => setTimeout(r, 5));
    return `[${system}] ${verb(a)}`;
  };

export const executors: Record<PlannedAction["kind"], Executor> = {
  page_security_lead: fake("pager", () => "Paged security lead (high urgency)"),
  assign_duty_manager: fake("helpdesk", () => "Assigned to duty manager"),
  assign_front_desk: fake("helpdesk", () => "Assigned to front-desk triage"),
  queue_refund: fake("payments", (a) => `Refund of ₹${a.params?.amountInr ?? "?"} issued`),
  prepare_waiver: fake("payments", () => "Penalty waiver applied"),
  open_barrier: fake("gate-controller", (a) => `Barrier ${a.params?.gate ?? ""} opened remotely`.replace("  ", " ")),
  notify_technician: fake("field-ops", () => "Technician notified with ticket context"),
  send_template: fake("helpdesk", (a) => `Sent fixed template "${a.params?.template}"`),
  resync_pass: fake("pass-service", () => "Pass re-synced and new QR sent"),
  execute_agent_action: fake("agent-runtime", (a) => `Agent action allowed: ${a.params?.description ?? ""}`),
  block_agent_action: fake("agent-runtime", () => "Agent action blocked"),
};

/** Run actions for a decision and audit each one. Returns result lines. */
export async function runActions(d: Decision, actions: PlannedAction[], actor: string): Promise<string[]> {
  const results: string[] = [];
  for (const a of actions) {
    try {
      const r = await executors[a.kind](a, d);
      results.push(r);
      await appendAudit({
        type: "action",
        workflow: d.workflow,
        decisionId: d.id,
        route: d.route,
        reason: r,
        actor,
        detail: { kind: a.kind },
      });
    } catch (e) {
      const msg = `Action ${a.kind} failed: ${(e as Error).message}`;
      results.push(msg);
      await appendAudit({ type: "error", workflow: d.workflow, decisionId: d.id, reason: msg, actor });
    }
  }
  return results;
}
