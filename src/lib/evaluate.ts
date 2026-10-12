import type { Config } from "./core/config";
import { runDecision } from "./core/engine";
import { band } from "./core/gate";
import type { Decision, Route } from "./core/types";
import type { JevClient } from "./jev/types";
import { AGENT_SAMPLES, SUPPORT_SAMPLES } from "./samples";
import { agentGuardWorkflow } from "./workflows/agentGuard";
import { supportWorkflow } from "./workflows/support";

/**
 * Offline evaluation (PRD §9 phase 1): run labelled cases, no actions, no persistence,
 * and report agreement with the staff label by confidence band.
 */

export interface EvalRow {
  id: string;
  workflow: "support" | "agent_guard";
  title: string;
  expected: Route;
  actual: Route;
  agree: boolean;
  confidence: number | null;
  band: "AUTO" | "REVIEW" | "HUMAN" | "n/a";
  rule: string | null;
  categoryExpected?: string;
  categoryActual?: string | null;
  /** Why Jev failed, when it did (HR-5). */
  error: string | null;
}

export interface EvalReport {
  rows: EvalRow[];
  byBand: Record<string, { total: number; agree: number; rate: number }>;
  overall: { total: number; agree: number; rate: number };
  /** Any safety or money case routed differently from staff. Must be 0 (PRD §9 phase 2 exit). */
  safetyOrMoneyDisagreements: number;
  autoBandMeetsTarget: boolean;
  target: number;
}

const AUTO_BAND_TARGET = 0.95;

function row(d: Decision, id: string, expected: Route, catExp: string | undefined, cfg: Config): EvalRow {
  return {
    id,
    workflow: d.workflow,
    title: d.title,
    expected,
    actual: d.route,
    agree: d.route === expected,
    confidence: d.gate.confidence,
    band: d.gate.confidence === null ? "n/a" : band(d.gate.confidence, cfg.thresholds),
    rule: d.rule,
    categoryExpected: catExp,
    categoryActual: d.category,
    error: d.error,
  };
}

export async function runEvaluation(cfg: Config, client?: JevClient): Promise<EvalReport> {
  const opts = { persist: false, execute: false, config: { ...cfg, shadowMode: false }, client };
  // Run cases in parallel (well under Jev's rate limit) so a real-Jev run takes seconds, not a minute.
  const rows: EvalRow[] = await Promise.all([
    ...SUPPORT_SAMPLES.map(async (s) => {
      const { decision } = await runDecision(supportWorkflow, s.input, opts);
      return row(decision, s.id, s.expected.route, s.expected.category, cfg);
    }),
    ...AGENT_SAMPLES.map(async (s) => {
      const { decision } = await runDecision(agentGuardWorkflow, s.input, opts);
      return row(decision, s.id, s.expected.route, undefined, cfg);
    }),
  ]);

  const byBand: EvalReport["byBand"] = {};
  for (const r of rows) {
    const b = (byBand[r.band] ??= { total: 0, agree: 0, rate: 0 });
    b.total++;
    if (r.agree) b.agree++;
  }
  for (const b of Object.values(byBand)) b.rate = b.total ? b.agree / b.total : 0;
  const agree = rows.filter((r) => r.agree).length;

  const sensitive = (r: EvalRow) =>
    r.expected === "BLOCKED" ||
    r.rule?.includes("Safety") ||
    r.rule?.includes("Money") ||
    ["double_charge", "penalty_dispute"].includes(r.categoryExpected ?? "") ||
    SUPPORT_SAMPLES.find((s) => s.id === r.id)?.expected.route === "HUMAN";
  const safetyOrMoneyDisagreements = rows.filter((r) => !r.agree && sensitive(r)).length;

  const auto = byBand.AUTO;
  return {
    rows,
    byBand,
    overall: { total: rows.length, agree, rate: rows.length ? agree / rows.length : 0 },
    safetyOrMoneyDisagreements,
    autoBandMeetsTarget: !auto || auto.rate >= AUTO_BAND_TARGET,
    target: AUTO_BAND_TARGET,
  };
}
