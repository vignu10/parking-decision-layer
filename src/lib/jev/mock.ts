import {
  type Answers,
  type ChoiceAnswer,
  type EvaluateOptions,
  type EvaluateResult,
  type JevClient,
  type Question,
  JevError,
  estimateTokens,
  noulAnswer,
} from "./types";

/**
 * Deterministic offline stand-in for Jev.
 *
 * Keyword heuristics produce plausible probabilities so the whole decision layer can be
 * demoed and tested without a key. Same input -> same output, always.
 *
 * Demo hooks:
 *  - text containing "[simulate-timeout]" hangs until aborted (shows F-7 timeout -> HUMAN)
 *  - text containing "[simulate-error]" throws an HTTP-style error (F-7)
 */

type Kw = (string | RegExp)[];

const hit = (text: string, kws: Kw) =>
  kws.filter((k) => (typeof k === "string" ? text.includes(k) : k.test(text))).length;

// Small, stable per-text jitter so numbers don't look canned.
function jitter(text: string, salt: string, amp = 0.03): number {
  let h = 2166136261;
  for (const c of text + salt) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * amp;
}

const clamp = (x: number, lo = 0.01, hi = 0.99) => Math.min(hi, Math.max(lo, x));

const CATEGORY_KW: Record<string, Kw> = {
  double_charge: ["charged twice", "double charge", "double charged", "deducted twice", "two times", "twice", "charged two", "duplicate charge", /charged \d+ times/],
  barrier_fault: ["barrier", "boom", "won't lift", "wont lift", "not lifting", "not opening", "gate is stuck", "gate won't", "arm is down"],
  info: ["opening hours", "what time", "how much", "rates", "price", "do you have", "ev charging", "is parking free", "where is", "timings", "free for"],
  lost_ticket: [/lost (?:my |the |our )?(?:parking )?ticket/, "lost my ticket", "lost ticket", "lost the ticket", "can't find my ticket", "cant find my ticket", "misplaced my ticket", "ticket is lost"],
  pass_issue: ["qr", "monthly pass", "season pass", "my pass", "pass shows", "not scanning", "won't scan", "scan"],
  penalty_dispute: ["penalty", "fine", "challan", "overstay", "dispute", "no-parking", "no parking"],
};

const SAFETY_KW: Kw = ["fire", "smoke", "injur", "hurt", "accident", "trapped", "locked inside", "unconscious", "attack", "threat", "hit by", "fell ", "bleeding", "gas leak", "collapsed", "very hot", "can't breathe", "fainted", "harass", "assault"];
const URGENT_KW: Kw = ["urgent", "asap", "right now", "immediately", "emergency", "stuck", "trapped", "queue behind", "can't exit", "cant exit", "please hurry", "help"];
const MONEY_KW: Kw = ["refund", "money back", "charged twice", "deducted twice", "reverse", "waive", "cancel it", "cancel the penalty", "want it back", "return my", "double charge", "took my money", "dispute this fine", "dispute"];

function category(text: string, q: Question): ChoiceAnswer {
  const options = Object.keys(q.options ?? {});
  const scores: Record<string, number> = {};
  for (const o of options) scores[o] = CATEGORY_KW[o] ? hit(text, CATEGORY_KW[o]) : 0;

  const matched = options.filter((o) => scores[o] > 0);
  const probabilities: Record<string, number> = {};
  if (matched.length === 0) {
    // Nothing recognisable -> "other", with only moderate confidence.
    for (const o of options) probabilities[o] = o === "other" ? 0.46 : 0.54 / (options.length - 1);
  } else {
    // Softmax-ish over keyword hits; ambiguity (several categories) lowers the top probability.
    const w: Record<string, number> = {};
    for (const o of options) w[o] = Math.exp(scores[o] * 2.2) - (scores[o] ? 0 : 0.9);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    for (const o of options) probabilities[o] = w[o] / sum;
  }
  const value = options.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a));
  const conf = clamp(probabilities[value] + jitter(text, "cat", 0.02), 0.3, 0.97);
  probabilities[value] = conf;
  return { id: q.id, type: "choice", value, confidence: conf, probabilities };
}

function section(state: string, name: string): string {
  const m = state.match(new RegExp(`${name}:\\s*([\\s\\S]*?)(?:\\n[A-Z ]+:|$)`));
  return (m?.[1] ?? "").toLowerCase();
}

function noulFor(id: string, text: string, state: string) {
  const j = (s: string) => jitter(text, s);
  switch (id) {
    case "is_safety_risk":
      return noulAnswer(id, hit(text, SAFETY_KW) ? clamp(0.93 + j(id)) : clamp(0.04 + Math.abs(j(id))));
    case "is_urgent": {
      const n = hit(text, URGENT_KW) + hit(text, SAFETY_KW);
      return noulAnswer(id, n >= 2 ? clamp(0.94 + j(id)) : n === 1 ? clamp(0.82 + j(id)) : clamp(0.14 + j(id)));
    }
    case "wants_money_back":
      return noulAnswer(id, hit(text, MONEY_KW) ? clamp(0.91 + j(id)) : clamp(0.06 + Math.abs(j(id))));

    // ---- Agent guard (D-9) ----
    case "violates_policy": {
      const action = section(state, "PROPOSED ACTION");
      const amount = Number(action.match(/amount_inr:\s*(\d+)/)?.[1] ?? 0);
      const bulk = /\ball\b|every|entire|bulk|disable|bypass|delete|turn off|permanently/.test(action);
      const big = amount > 5000;
      return noulAnswer(id, bulk || big ? clamp(0.93 + j(id)) : clamp(0.07 + Math.abs(j(id))));
    }
    case "matches_request": {
      const request = section(state, "CUSTOMER REQUEST");
      const action = section(state, "PROPOSED ACTION");
      const type = action.match(/type:\s*(\w+)/)?.[1] ?? "";
      const amount = action.match(/amount_inr:\s*(\d+)/)?.[1];
      const reqNums = request.match(/\d[\d,]*/g)?.map((n) => n.replace(/,/g, "")) ?? [];
      const topical: Record<string, RegExp> = {
        refund: /refund|charged|money|deduct|twice|payment|back/,
        waive_penalty: /penalty|fine|overstay|waive|dispute/,
        open_barrier: /barrier|gate|exit|stuck|lift/,
        send_message: /.*/,
        resync_pass: /pass|qr|scan/,
      };
      const onTopic = topical[type]?.test(request) ?? false;
      const amountMismatch = amount !== undefined && reqNums.length > 0 && !reqNums.includes(amount);
      let p = onTopic ? 0.9 : 0.12;
      if (amountMismatch) p = 0.15;
      return noulAnswer(id, clamp(p + j(id)));
    }
    default:
      return noulAnswer(id, 0.5);
  }
}

export class MockJevClient implements JevClient {
  readonly name = "jev:mock";
  constructor(private readonly latency: [number, number] = [70, 220]) {}

  async evaluate(state: string, questions: Question[], opts: EvaluateOptions = {}): Promise<EvaluateResult> {
    const started = Date.now();
    const text = state.toLowerCase();

    if (text.includes("[simulate-error]")) throw new JevError("Jev HTTP 503: upstream unavailable (simulated)", "http");
    if (text.includes("[simulate-timeout]")) {
      await new Promise<void>((_, reject) => {
        const t = setTimeout(() => reject(new JevError("Jev request timed out (simulated)", "timeout")), 60_000);
        opts.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new JevError("Jev request timed out", "timeout"));
        });
      });
    }

    const [lo, hi] = this.latency;
    const delay = lo + Math.abs(jitter(text, "lat", 0.5)) * 2 * (hi - lo);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));

    // For agent-guard items, judge the customer request + proposed action, not the policy boilerplate.
    const judged = text.includes("customer request:")
      ? section(state, "CUSTOMER REQUEST") + " " + section(state, "PROPOSED ACTION")
      : text;

    const answers: Answers = {};
    for (const q of questions) {
      answers[q.id] = q.type === "choice" ? category(judged, q) : noulFor(q.id, judged, state);
    }
    const tokens = estimateTokens(state + JSON.stringify(questions));
    return { answers, inputTokens: tokens, latencyMs: Date.now() - started, provider: this.name };
  }
}
