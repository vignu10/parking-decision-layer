import { createJevClient } from "../jev";
import { type Answers, type JevClient, type Question, JevError, PRICE_PER_INPUT_TOKEN_USD } from "../jev/types";
import { runActions } from "../integrations";
import type { Config } from "./config";
import { redact } from "./redact";
import { appendAudit, getConfig, getDecision, saveDecision } from "./store";
import type { Decision, DecisionStatus, Verdict, Workflow } from "./types";

export interface WorkflowDef<I> {
  id: Workflow;
  killSwitchKey: keyof Config["killSwitch"];
  questions: Question[];
  title(input: I): string;
  /** Raw text for Jev; the engine redacts it. */
  buildState(input: I): string;
  /** Rules applied to Jev's answers: hard rules first, then the confidence gate. */
  decide(answers: Answers, input: I, cfg: Config): Verdict;
  /** Route when Jev is unavailable or the kill switch is on. Must never be AUTO (F-7, HR-5). */
  fallback(input: I, reason: string, rule: string, cfg: Config): Verdict;
}

export interface RunOptions {
  client?: JevClient;
  /** Store the decision + audit it. Off for offline evaluation. */
  persist?: boolean;
  /** Run "now" actions. Off for offline evaluation. Shadow mode also suppresses actions. */
  execute?: boolean;
  config?: Config;
  actor?: string;
}

export interface RunResult {
  decision: Decision;
  actionResults: string[];
}

let defaultClient: JevClient | null = null;
function client(): JevClient {
  return (defaultClient ??= createJevClient());
}

const STATUS: Record<Verdict["route"], DecisionStatus> = {
  AUTO: "executed",
  REVIEW: "pending_approval",
  HUMAN: "assigned",
  BLOCKED: "blocked",
};

function newId() {
  return `dec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function runDecision<I>(wf: WorkflowDef<I>, input: I, opts: RunOptions = {}): Promise<RunResult> {
  const cfg = opts.config ?? (await getConfig());
  const persist = opts.persist ?? true;
  const execute = opts.execute ?? true;
  const actor = opts.actor ?? "decision-layer";
  const jev = opts.client ?? client();

  const raw = wf.buildState(input);
  const { text: state, count: redactions } = cfg.redactPii ? redact(raw) : { text: raw, count: 0 };

  let verdict: Verdict;
  let answers: Answers | null = null;
  let error: string | null = null;
  let latencyMs = 0;
  let inputTokens = 0;
  let billedCostUsd: number | undefined;
  let provider = jev.name;

  if (cfg.killSwitch[wf.killSwitchKey]) {
    verdict = wf.fallback(input, "Kill switch is on for this workflow — everything goes to a person.", "KILL-SWITCH", cfg);
  } else {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    const started = Date.now();
    try {
      const res = await Promise.race([
        jev.evaluate(state, wf.questions, { signal: ac.signal }),
        new Promise<never>((_, reject) =>
          ac.signal.addEventListener("abort", () => reject(new JevError(`Timed out after ${cfg.timeoutMs} ms`, "timeout"))),
        ),
      ]);
      answers = res.answers;
      latencyMs = res.latencyMs;
      inputTokens = res.inputTokens;
      billedCostUsd = res.costUsd;
      provider = res.provider;
      verdict = wf.decide(answers, input, cfg);
    } catch (e) {
      latencyMs = Date.now() - started;
      error = e instanceof JevError ? `${e.kind}: ${e.message}` : `unexpected: ${(e as Error).message}`;
      verdict = wf.fallback(input, `Jev unavailable (${error}). Routed to a person.`, "HR-5 Model/API failure", cfg);
      answers = null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Defence in depth: a fallback can never be AUTO.
  if ((error || verdict.rule === "KILL-SWITCH") && verdict.route === "AUTO") verdict = { ...verdict, route: "HUMAN" };

  const decision: Decision = {
    id: newId(),
    workflow: wf.id,
    createdAt: new Date().toISOString(),
    title: wf.title(input),
    state,
    redactions,
    answers,
    gate: verdict.gate,
    route: verdict.route,
    rule: verdict.rule,
    reason: verdict.reason,
    actions: verdict.actions,
    status: cfg.shadowMode ? "shadow" : STATUS[verdict.route],
    urgent: verdict.urgent,
    category: verdict.category,
    shadow: cfg.shadowMode,
    provider,
    latencyMs,
    inputTokens,
    costUsd: billedCostUsd ?? inputTokens * PRICE_PER_INPUT_TOKEN_USD,
    error,
  };

  let actionResults: string[] = [];
  if (persist) {
    await saveDecision(decision);
    await appendAudit({
      type: error ? "error" : "decision",
      workflow: wf.id,
      decisionId: decision.id,
      route: decision.route,
      confidence: decision.gate.confidence,
      rule: decision.rule,
      reason: decision.reason,
      actor,
      shadow: decision.shadow,
      detail: { category: decision.category, weakest: decision.gate.weakest, provider, latencyMs, error },
    });
  }
  if (execute && !decision.shadow) {
    const now = decision.actions.filter((a) => a.when === "now");
    if (now.length) actionResults = await runActions(decision, now, actor);
  }
  return { decision, actionResults };
}

export type Resolution = "approve" | "reject" | "handled";

/** Staff resolve a queued decision. Money actions only ever run through here (HR-2). */
export async function resolveDecision(id: string, resolution: Resolution, actor: string): Promise<RunResult> {
  const d = await getDecision(id);
  if (!d) throw new Error("Decision not found");
  if (!actor?.trim()) throw new Error("An approver name is required for the audit trail");
  if (d.status !== "pending_approval" && d.status !== "assigned") throw new Error(`Decision is already ${d.status}`);

  let actionResults: string[] = [];
  const pending = d.actions.filter((a) => a.when === "on_approval");

  if (resolution === "approve") {
    if (!pending.length) throw new Error("Nothing to approve on this decision");
    await appendAudit({
      type: "approval",
      workflow: d.workflow,
      decisionId: d.id,
      route: d.route,
      reason: `Approved: ${pending.map((a) => a.label).join("; ")}`,
      actor,
    });
    actionResults = await runActions(d, pending, actor);
    d.status = "approved";
  } else if (resolution === "reject") {
    await appendAudit({
      type: "rejection",
      workflow: d.workflow,
      decisionId: d.id,
      route: d.route,
      reason: `Rejected suggested action (override): ${pending.map((a) => a.label).join("; ") || "none"}`,
      actor,
    });
    d.status = "rejected";
  } else {
    await appendAudit({ type: "handled", workflow: d.workflow, decisionId: d.id, route: d.route, reason: "Handled by staff", actor });
    d.status = "handled";
  }
  d.resolvedBy = actor;
  d.resolvedAt = new Date().toISOString();
  await saveDecision(d, false);
  return { decision: d, actionResults };
}
