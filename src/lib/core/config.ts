/**
 * Runtime configuration (PRD F-6: thresholds and limits are config, not code).
 * Values are the PRD's initial placeholders — tune them after offline evaluation.
 */
export interface Config {
  thresholds: {
    /** confidence >= auto -> AUTO */
    auto: number;
    /** review <= confidence < auto -> REVIEW; below -> HUMAN */
    review: number;
  };
  /**
   * Safety is a hard stop. We treat P(safety) at or above this as a safety item even when
   * Jev's yes/no leans "no" — missing a safety message is the worst failure (PRD §11).
   */
  safetyTriggerProbability: number;
  /** F-8: decide and log, but take no actions. */
  shadowMode: boolean;
  /** Per-workflow kill switch: everything routes to HUMAN (PRD §9). */
  killSwitch: { support: boolean; agentGuard: boolean };
  /**
   * Which AUTO actions are switched on. Mirrors the rollout plan (§9):
   * phase 4 enables only fixed-template replies; barrier open and pass re-sync come in phase 5.
   * When an action is off, a confident item drops to REVIEW instead of AUTO.
   */
  autoActions: { sendTemplate: boolean; passResync: boolean; barrierRemoteOpen: boolean };
  agentGuard: {
    /** D-10: refunds above this always need human approval. */
    refundLimitInr: number;
    /**
     * D-10 allows refunds at/below the limit to execute at high confidence, but hard rule #2
     * and acceptance criterion #2 say no refund executes without approval. Off by default
     * until the PRD owner resolves the conflict.
     */
    autoExecuteSmallRefunds: boolean;
  };
  /** F-7 / NFR latency: give up on Jev after this and route to HUMAN. */
  timeoutMs: number;
  /** NFR privacy: redact PII before calling an external model. */
  redactPii: boolean;
}

export const DEFAULT_CONFIG: Config = {
  thresholds: { auto: 0.8, review: 0.55 },
  safetyTriggerProbability: 0.3,
  shadowMode: false,
  killSwitch: { support: false, agentGuard: false },
  autoActions: { sendTemplate: true, passResync: false, barrierRemoteOpen: false },
  agentGuard: { refundLimitInr: 500, autoExecuteSmallRefunds: false },
  timeoutMs: 2500,
  redactPii: true,
};

export function validateConfig(c: Config): string[] {
  const errs: string[] = [];
  const { auto, review } = c.thresholds;
  if (!(auto > 0 && auto <= 1)) errs.push("thresholds.auto must be in (0, 1]");
  if (!(review >= 0 && review < auto)) errs.push("thresholds.review must be >= 0 and below thresholds.auto");
  if (!(c.safetyTriggerProbability > 0 && c.safetyTriggerProbability <= 0.5))
    errs.push("safetyTriggerProbability must be in (0, 0.5]");
  if (!(c.agentGuard.refundLimitInr >= 0)) errs.push("agentGuard.refundLimitInr must be >= 0");
  if (!(c.timeoutMs >= 100 && c.timeoutMs <= 30000)) errs.push("timeoutMs must be 100–30000");
  return errs;
}

/** Deep-merge a partial patch into a config. */
export function mergeConfig(base: Config, patch: DeepPartial<Config>): Config {
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = { ...(out[k] as object), ...(v as object) };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as unknown as Config;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
