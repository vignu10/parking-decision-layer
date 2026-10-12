import type { Answers, NoulAnswer, Question } from "../jev/types";
import type { WorkflowDef } from "../core/engine";
import { gateConfidence, routeFor } from "../core/gate";
import type { PlannedAction, Verdict } from "../core/types";

/** PRD §6.3 D-9 / D-10 — Agent guard: check an AI agent's proposed action before it runs. */

export type AgentActionType = "refund" | "waive_penalty" | "open_barrier" | "send_message" | "resync_pass";

export interface AgentGuardInput {
  /** What the customer / operator actually asked for. */
  request: string;
  action: { type: AgentActionType; amountInr?: number; description: string };
  agent?: string;
}

export const OPERATIONS_POLICY = `- Refunds only for the customer's own verified transaction, never more than the amount charged.
- Penalty waivers only for the disputed penalty on the customer's own vehicle.
- No bulk actions across customers or sites.
- Never disable, bypass or reconfigure payment, penalty or gate systems.
- Barrier remote-open only for a reported fault at a named gate.
- Customer messages must use approved templates.`;

export const AGENT_QUESTIONS: Question[] = [
  { id: "violates_policy", type: "noul", instructions: "Does the PROPOSED ACTION violate the POLICY?" },
  { id: "matches_request", type: "noul", instructions: "Does the PROPOSED ACTION match what the CUSTOMER REQUEST actually asked for (type, scope and amount)?" },
];

const GATING = ["violates_policy", "matches_request"];
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

function describe(i: AgentGuardInput) {
  const amt = i.action.amountInr !== undefined ? ` ₹${i.action.amountInr}` : "";
  return `${i.action.type.replace("_", " ")}${amt}: ${i.action.description}`;
}

export const agentGuardWorkflow: WorkflowDef<AgentGuardInput> = {
  id: "agent_guard",
  killSwitchKey: "agentGuard",
  questions: AGENT_QUESTIONS,

  title: (i) => `${i.agent ?? "agent"} → ${describe(i)}`.slice(0, 110),

  buildState: (i) =>
    [
      "POLICY:",
      OPERATIONS_POLICY,
      "",
      "CUSTOMER REQUEST:",
      i.request,
      "",
      "PROPOSED ACTION:",
      `type: ${i.action.type}`,
      i.action.amountInr !== undefined ? `amount_inr: ${i.action.amountInr}` : null,
      `description: ${i.action.description}`,
    ]
      .filter((l) => l !== null)
      .join("\n"),

  decide(answers: Answers, input, cfg): Verdict {
    const violates = answers.violates_policy as NoulAnswer;
    const matches = answers.matches_request as NoulAnswer;
    const gate = gateConfidence(answers, GATING);
    const desc = describe(input);
    const exec = (when: PlannedAction["when"]): PlannedAction => ({
      kind: "execute_agent_action",
      label: `Allow agent: ${desc}`,
      when,
      params: { description: desc },
    });
    const block: PlannedAction = { kind: "block_agent_action", label: "Block agent action", when: "now" };
    const base = { urgent: false, category: input.action.type, gate };

    // HR-4: blocking is the safe direction, so block whenever the model leans that way.
    if (violates.value)
      return { ...base, route: "BLOCKED", rule: "HR-4 Policy violation", reason: `Proposed action likely violates policy (p=${pct(violates.probability)}).`, actions: [block] };
    if (!matches.value)
      return { ...base, route: "BLOCKED", rule: "HR-4 Request mismatch", reason: `Proposed action does not match the request (p(match)=${pct(matches.probability)}).`, actions: [block] };

    const route = routeFor(gate.confidence, cfg.thresholds);
    if (route === "HUMAN")
      return { ...base, route: "HUMAN", rule: null, reason: `Low confidence (weakest: ${gate.weakest} at ${pct(gate.confidence)}). A person decides.`, actions: [exec("on_approval")] };

    const t = input.action.type;
    if (t === "refund" || t === "waive_penalty") {
      const amt = input.action.amountInr ?? Infinity;
      if (amt > cfg.agentGuard.refundLimitInr)
        return { ...base, route: "REVIEW", rule: "D-10 Over refund limit", reason: `₹${input.action.amountInr ?? "?"} is above the ₹${cfg.agentGuard.refundLimitInr} limit. Needs human approval.`, actions: [exec("on_approval")] };
      if (t === "refund" && route === "AUTO" && cfg.agentGuard.autoExecuteSmallRefunds)
        return { ...base, route: "AUTO", rule: "D-10 Within limit", reason: `Within ₹${cfg.agentGuard.refundLimitInr} limit at high confidence (${pct(gate.confidence)}). Executed.`, actions: [exec("now")] };
      return { ...base, route: "REVIEW", rule: "HR-2 Money", reason: "Passes policy and matches the request. Money actions need staff approval.", actions: [exec("on_approval")] };
    }
    if (t === "open_barrier" && !cfg.autoActions.barrierRemoteOpen)
      return { ...base, route: "REVIEW", rule: null, reason: "Passes the guard, but remote barrier open is not enabled for AUTO in this rollout phase.", actions: [exec("on_approval")] };
    if (t === "resync_pass" && !cfg.autoActions.passResync)
      return { ...base, route: "REVIEW", rule: null, reason: "Passes the guard, but pass re-sync is not enabled for AUTO in this rollout phase.", actions: [exec("on_approval")] };

    if (route === "AUTO")
      return { ...base, route: "AUTO", rule: null, reason: `Passes policy and matches the request (${pct(gate.confidence)}). Allowed.`, actions: [exec("now")] };
    return { ...base, route: "REVIEW", rule: null, reason: `Medium confidence (weakest: ${gate.weakest} at ${pct(gate.confidence)}). Staff approve.`, actions: [exec("on_approval")] };
  },

  fallback(input, reason, rule): Verdict {
    return {
      route: "HUMAN",
      rule,
      reason: `${reason} The agent action is held until a person approves it.`,
      urgent: false,
      category: input.action.type,
      gate: { confidence: null, weakest: null, questions: GATING },
      actions: [{ kind: "execute_agent_action", label: `Allow agent: ${describe(input)}`, when: "on_approval", params: { description: describe(input) } }],
    };
  },
};
