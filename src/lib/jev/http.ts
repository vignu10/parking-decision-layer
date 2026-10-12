import {
  type Answer,
  type Answers,
  type EvaluateOptions,
  type EvaluateResult,
  type JevClient,
  type Question,
  JevError,
  estimateTokens,
  noulAnswer,
} from "./types";

/**
 * Real Jev client over HTTP.
 *
 * Two dialects are supported behind the same interface:
 *  - "vercel":   POST https://ai-gateway.vercel.sh/v1/evaluate  (yes/no type is spelled "boolean")
 *  - "typesafe": POST https://api.typesafe.ai/v1/systemone      (yes/no type is spelled "noul")
 *
 * Request: { model, state, questions: { [id]: { type, instructions, criteria? } } }
 * Response: { answers: { [id]: {...} }, usage: { inputTokens | input_tokens }, providerMetadata.gateway.cost }
 *
 * Vercel shape verified with a real call on 13 Oct 2026: choice -> { choice, probabilities, confidence },
 * boolean -> { probability }.
 *
 * PRD §10 flags the exact field names as UNVERIFIED. The parser below is deliberately
 * tolerant, and anything it cannot read throws a JevError, which the decision engine
 * turns into a HUMAN route (F-7). Run `npm run verify:jev` once to see the real shape.
 */

export type Dialect = "vercel" | "typesafe";

const DEFAULTS: Record<Dialect, { url: string; model: string; keyEnv: string }> = {
  vercel: { url: "https://ai-gateway.vercel.sh/v1/evaluate", model: "typesafe-ai/jev", keyEnv: "AI_GATEWAY_API_KEY" },
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", keyEnv: "TYPESAFE_API_KEY" },
};

export interface HttpJevOptions {
  dialect: Dialect;
  apiKey?: string;
  url?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export class HttpJevClient implements JevClient {
  readonly name: string;
  private readonly url: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly dialect: Dialect;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpJevOptions) {
    const d = DEFAULTS[opts.dialect];
    this.dialect = opts.dialect;
    this.url = opts.url ?? d.url;
    this.model = opts.model ?? d.model;
    this.apiKey = opts.apiKey ?? process.env[d.keyEnv] ?? "";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.name = `jev:${opts.dialect}`;
    if (!this.apiKey) throw new JevError(`Missing ${d.keyEnv}`, "config");
  }

  buildBody(state: string, questions: Question[]) {
    const qs: Record<string, unknown> = {};
    for (const q of questions) {
      if (q.type === "noul") {
        qs[q.id] = { type: this.dialect === "vercel" ? "boolean" : "noul", instructions: q.instructions };
      } else {
        qs[q.id] = { type: "choice", instructions: q.instructions, criteria: q.options ?? {} };
      }
    }
    return { model: this.model, state, questions: qs };
  }

  async evaluate(state: string, questions: Question[], opts: EvaluateOptions = {}): Promise<EvaluateResult> {
    const body = this.buildBody(state, questions);
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw new JevError("Jev request timed out", "timeout");
      throw new JevError(`Network error: ${(e as Error).message}`, "network");
    }
    if (res.status === 429) throw new JevError("Jev rate limit hit", "rate_limit");
    if (!res.ok) {
      // Never echo the response body into logs blindly; keep it short.
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new JevError(`Jev HTTP ${res.status}: ${text}`, "http");
    }
    const json = (await res.json()) as Record<string, unknown>;
    let answers: Answers;
    try {
      answers = parseAnswers(json, questions);
    } catch (e) {
      throw new JevError((e as Error).message, "parse", json);
    }
    const usage = json.usage as { input_tokens?: number; inputTokens?: number } | undefined;
    const gatewayCost = Number(
      (json.providerMetadata as { gateway?: { cost?: string | number } } | undefined)?.gateway?.cost,
    );
    return {
      answers,
      inputTokens: usage?.inputTokens ?? usage?.input_tokens ?? estimateTokens(JSON.stringify(body)),
      costUsd: Number.isFinite(gatewayCost) ? gatewayCost : undefined,
      latencyMs: Date.now() - started,
      provider: this.name,
      raw: json,
    };
  }
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function parseAnswers(json: Record<string, unknown>, questions: Question[]): Answers {
  const raw = (json.answers ?? (json.output as Record<string, unknown> | undefined)?.answers) as
    | Record<string, unknown>
    | undefined;
  if (!raw || typeof raw !== "object") throw new JevError("Response has no `answers` object", "parse");

  const out: Answers = {};
  for (const q of questions) {
    const a = raw[q.id];
    if (a === undefined) throw new JevError(`Missing answer for ${q.id}`, "parse");
    out[q.id] = q.type === "noul" ? parseNoul(q, a) : parseChoice(q, a);
  }
  return out;
}

function parseNoul(q: Question, a: unknown): Answer {
  if (typeof a === "number") return noulAnswer(q.id, a);
  const o = (a ?? {}) as Record<string, unknown>;
  const p = num(o.probability) ?? num(o.noul) ?? num(o.p) ?? num(o.yes);
  if (p === undefined) throw new JevError(`Cannot read probability for ${q.id}`, "parse");
  return noulAnswer(q.id, p);
}

function parseChoice(q: Question, a: unknown): Answer {
  const o = (a ?? {}) as Record<string, unknown>;
  const value = (o.choice ?? o.answer ?? o.value) as string | undefined;
  const options = Object.keys(q.options ?? {});
  if (typeof value !== "string" || !options.includes(value)) {
    throw new JevError(`Choice for ${q.id} is not one of the allowed options`, "parse");
  }
  const probabilities = (o.probabilities ?? {}) as Record<string, number>;
  const confidence = num(o.confidence) ?? num(probabilities[value]);
  if (confidence === undefined) throw new JevError(`Cannot read confidence for ${q.id}`, "parse");
  return { id: q.id, type: "choice", value, confidence, probabilities };
}
