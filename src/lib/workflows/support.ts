import type { Answers, ChoiceAnswer, NoulAnswer, Question } from "../jev/types";
import type { Config } from "../core/config";
import type { WorkflowDef } from "../core/engine";
import { capAtReview, gateConfidence, routeFor } from "../core/gate";
import type { PlannedAction, Verdict } from "../core/types";

/** PRD §6.2 — Support desk. */

export interface SupportInput {
  text: string;
  channel?: "email" | "app" | "whatsapp" | "kiosk";
  site?: string;
}

export const CATEGORIES = {
  double_charge: "Customer was charged more than once for the same parking session",
  barrier_fault: "Entry/exit barrier or gate is not working",
  info: "General information request: hours, rates, facilities, location",
  lost_ticket: "Customer lost or cannot find their parking ticket",
  pass_issue: "Problem with a monthly/season pass or QR code",
  penalty_dispute: "Customer disputes a penalty, fine or overstay charge",
  other: "None of the above or unclear",
} as const;

export type Category = keyof typeof CATEGORIES;

export const SUPPORT_QUESTIONS: Question[] = [
  { id: "category", type: "choice", instructions: "What is this parking customer's message mainly about?", options: { ...CATEGORIES } },
  { id: "is_urgent", type: "noul", instructions: "Does the message convey urgency (customer stuck, time-critical, blocking others)?" },
  { id: "is_safety_risk", type: "noul", instructions: "Does the message describe a risk to anyone's physical safety (fire, injury, person trapped, threat)?" },
  { id: "wants_money_back", type: "noul", instructions: "Is the customer asking for money back or for a penalty to be cancelled?" },
];

/** Questions that gate the routing decision (F-2). is_urgent only sets priority. */
const GATING = ["category", "is_safety_risk", "wants_money_back"];

/**
 * Deterministic safety keywords. Our own code, independent of the model, so a safety message
 * is caught even if Jev under-scores it or is down (PRD §11: "keyword and model signals").
 */
const SAFETY_KEYWORDS =
  /\b(fire|smoke|injur\w*|hurt|accident|trapped|locked (?:in|inside)|unconscious|fainted|collapsed|attack\w*|assault\w*|threat\w*|bleeding|gas leak|can'?t breathe|harass\w*|emergency)\b/i;

export const TEMPLATES: Record<string, string> = {
  info: "INFO_GENERAL_v2 — hours, rates and facilities for the site, with a link to the help centre.",
  lost_ticket: "LOST_TICKET_v3 — how to exit with a lost ticket (pay max daily rate at the pay station or show booking ID at the exit intercom).",
};

export function safetyKeywordHit(text: string): boolean {
  return SAFETY_KEYWORDS.test(text);
}

export function extractAmountInr(text: string): number | undefined {
  const m = text.match(/(?:₹|rs\.?|inr)\s?(\d[\d,]*)/i);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

function safetyVerdict(reason: string, gate: Verdict["gate"], category: string | null): Verdict {
  return {
    route: "HUMAN",
    rule: "HR-1 Safety",
    reason,
    urgent: true,
    category,
    gate,
    actions: [
      { kind: "page_security_lead", label: "Page security lead", when: "now" },
      { kind: "assign_duty_manager", label: "Assign to duty manager", when: "now" },
    ],
  };
}

function frontDesk(reason: string, rule: string | null, gate: Verdict["gate"], category: string | null, urgent: boolean): Verdict {
  return {
    route: "HUMAN",
    rule,
    reason,
    urgent,
    category,
    gate,
    actions: [{ kind: "assign_front_desk", label: "Assign to front-desk triage", when: "now" }],
  };
}

/** Actions per category, and whether AUTO is switched on for them in this rollout phase. */
function categoryPlan(cat: Category, input: SupportInput, cfg: Config): { actions: Omit<PlannedAction, "when">[]; autoEnabled: boolean; label: string } {
  switch (cat) {
    case "info":
    case "lost_ticket":
      return {
        label: "fixed template reply",
        autoEnabled: cfg.autoActions.sendTemplate,
        actions: [{ kind: "send_template", label: `Send template ${TEMPLATES[cat].split(" ")[0]}`, params: { template: TEMPLATES[cat].split(" ")[0] } }],
      };
    case "pass_issue":
      return {
        label: "pass re-sync",
        autoEnabled: cfg.autoActions.passResync,
        actions: [{ kind: "resync_pass", label: "Re-sync pass and send new QR" }],
      };
    case "barrier_fault":
      return {
        label: "remote barrier open",
        autoEnabled: cfg.autoActions.barrierRemoteOpen,
        actions: [
          { kind: "open_barrier", label: "Open barrier remotely", params: { gate: input.site ?? "" } },
          { kind: "notify_technician", label: "Notify technician" },
        ],
      };
    case "double_charge":
      return {
        label: "refund",
        autoEnabled: false,
        actions: [{ kind: "queue_refund", label: `Refund${amountLabel(input)} (duplicate charge)`, params: { amountInr: extractAmountInr(input.text) } }],
      };
    case "penalty_dispute":
      return {
        label: "penalty waiver",
        autoEnabled: false,
        actions: [{ kind: "prepare_waiver", label: "Waive disputed penalty" }],
      };
    default:
      return { label: "none", autoEnabled: false, actions: [] };
  }
}

function amountLabel(input: SupportInput) {
  const a = extractAmountInr(input.text);
  return a ? ` ₹${a}` : "";
}

export const supportWorkflow: WorkflowDef<SupportInput> = {
  id: "support",
  killSwitchKey: "support",
  questions: SUPPORT_QUESTIONS,

  title: (i) => (i.text.length > 90 ? i.text.slice(0, 87) + "…" : i.text),
  buildState: (i) => i.text,

  decide(answers: Answers, input, cfg): Verdict {
    const cat = answers.category as ChoiceAnswer;
    const safety = answers.is_safety_risk as NoulAnswer;
    const urgentA = answers.is_urgent as NoulAnswer;
    const money = answers.wants_money_back as NoulAnswer;
    const gate = gateConfidence(answers, GATING);
    const category = cat.value as Category;
    const urgent = urgentA.value;

    // HR-1 / S-1: safety always goes to a person, regardless of confidence.
    if (safety.probability >= cfg.safetyTriggerProbability || safetyKeywordHit(input.text)) {
      const why = safety.value
        ? `Jev flagged a safety risk (p=${pct(safety.probability)}).`
        : safety.probability >= cfg.safetyTriggerProbability
          ? `Possible safety risk (p=${pct(safety.probability)} ≥ trigger ${pct(cfg.safetyTriggerProbability)}).`
          : "Safety keyword matched by our own rule.";
      return safetyVerdict(`${why} Never automated: paging security and the duty manager.`, gate, category);
    }

    const base = routeFor(gate.confidence, cfg.thresholds);
    const weakest = `weakest: ${gate.weakest} at ${pct(gate.confidence)}`;

    // S-7: unclear category or low confidence -> front desk.
    if (category === "other") return frontDesk(`Category unclear ("other"). Front desk to triage.`, null, gate, category, urgent);
    if (base === "HUMAN") return frontDesk(`Low confidence (${weakest}). Front desk to triage.`, null, gate, category, urgent);

    const plan = categoryPlan(category, input, cfg);
    const isMoneyCategory = category === "double_charge" || category === "penalty_dispute";

    // HR-2 / S-2 / S-3: money is never executed automatically.
    if (isMoneyCategory || money.value) {
      const actions: PlannedAction[] = plan.actions.map((a) => ({ ...a, when: "on_approval" }));
      if (!isMoneyCategory) {
        actions.push({
          kind: "queue_refund",
          label: `Review refund request${amountLabel(input)}`,
          when: "on_approval",
          params: { amountInr: extractAmountInr(input.text) },
        });
      }
      return {
        route: capAtReview(base),
        rule: "HR-2 Money",
        reason: `Money involved (${plan.label === "none" ? "refund request" : plan.label}). Prepared for staff approval; never executed automatically.`,
        urgent,
        category,
        gate,
        actions,
      };
    }

    // S-4 / S-5 / S-6 / S-8
    if (base === "AUTO" && plan.autoEnabled) {
      return {
        route: "AUTO",
        rule: null,
        reason: `Confident (${weakest}) and low-risk: ${plan.label} sent automatically.`,
        urgent,
        category,
        gate,
        actions: plan.actions.map((a) => ({ ...a, when: "now" })),
      };
    }
    const reason =
      base === "AUTO"
        ? `Confident, but AUTO for ${plan.label} is not switched on in this rollout phase. Suggested action awaits approval.`
        : `Medium confidence (${weakest}). Suggested action awaits approval.`;
    return {
      route: "REVIEW",
      rule: null,
      reason,
      urgent,
      category,
      gate,
      actions: plan.actions.map((a) => ({ ...a, when: "on_approval" })),
    };
  },

  fallback(input, reason, rule): Verdict {
    const gate = { confidence: null, weakest: null, questions: GATING };
    // Our own safety keywords still work when Jev is down.
    if (safetyKeywordHit(input.text)) return { ...safetyVerdict(`${reason} Safety keyword matched.`, gate, null), rule: `${rule} + HR-1 Safety` };
    return frontDesk(reason, rule, gate, null, false);
  },
};
