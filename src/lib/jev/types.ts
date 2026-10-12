/**
 * Jev client contract (PRD F-1).
 *
 * One request carries an item ("state") plus a set of typed questions.
 * Jev answers each question with a typed value and a confidence.
 */

export type QuestionType = "noul" | "choice";

export interface Question {
  id: string;
  type: QuestionType;
  /** Plain-language instructions for Jev. */
  instructions: string;
  /** Choice only: option name -> description. */
  options?: Record<string, string>;
}

export interface NoulAnswer {
  id: string;
  type: "noul";
  value: boolean;
  /** P(yes), 0..1 */
  probability: number;
  /** max(p, 1 - p) */
  confidence: number;
}

export interface ChoiceAnswer {
  id: string;
  type: "choice";
  value: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer;
export type Answers = Record<string, Answer>;

export interface EvaluateResult {
  answers: Answers;
  inputTokens: number;
  /** Actual billed cost in USD, when the provider reports it (Vercel AI Gateway does). */
  costUsd?: number;
  latencyMs: number;
  provider: string;
  /** Raw response body, kept for debugging / verifying the real API shape. */
  raw?: unknown;
}

export interface EvaluateOptions {
  signal?: AbortSignal;
}

export interface JevClient {
  readonly name: string;
  evaluate(state: string, questions: Question[], opts?: EvaluateOptions): Promise<EvaluateResult>;
}

export class JevError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "http" | "rate_limit" | "parse" | "config" | "network",
    /** Raw response body, when there was one (helps fix the parser against the real API). */
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "JevError";
  }
}

/** Vendor-listed input price (PRD §7): ~$0.042 per 1M input tokens, output free. */
export const PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1_000_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function noulAnswer(id: string, probability: number): NoulAnswer {
  const p = Math.min(1, Math.max(0, probability));
  return { id, type: "noul", value: p >= 0.5, probability: p, confidence: Math.max(p, 1 - p) };
}
