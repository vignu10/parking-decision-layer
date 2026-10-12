import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, mergeConfig, validateConfig } from "@/lib/core/config";
import { runDecision } from "@/lib/core/engine";
import { gateConfidence, routeFor } from "@/lib/core/gate";
import { redact } from "@/lib/core/redact";
import { listAudit } from "@/lib/core/store";
import { HttpJevClient, parseAnswers } from "@/lib/jev/http";
import { noulAnswer } from "@/lib/jev/types";
import { supportWorkflow, SUPPORT_QUESTIONS } from "@/lib/workflows/support";
import { fastMock, freshStore, stubJev } from "./helpers";

beforeEach(async () => {
  await freshStore();
});

describe("F-2 / F-3 confidence gate", () => {
  it("decision confidence is the minimum across gating questions", () => {
    const answers = {
      a: noulAnswer("a", 0.95),
      b: noulAnswer("b", 0.3), // confidence 0.7
      c: { id: "c", type: "choice" as const, value: "x", confidence: 0.9, probabilities: {} },
    };
    const g = gateConfidence(answers, ["a", "b", "c"]);
    expect(g.confidence).toBeCloseTo(0.7);
    expect(g.weakest).toBe("b");
  });

  it("routes by thresholds", () => {
    const t = DEFAULT_CONFIG.thresholds;
    expect(routeFor(0.8, t)).toBe("AUTO");
    expect(routeFor(0.79, t)).toBe("REVIEW");
    expect(routeFor(0.55, t)).toBe("REVIEW");
    expect(routeFor(0.54, t)).toBe("HUMAN");
    expect(routeFor(null, t)).toBe("HUMAN");
  });

  it("one weak question pulls a confident item down to REVIEW", async () => {
    const jev = stubJev({ choice: { category: ["info", 0.97] }, noul: { wants_money_back: 0.3, is_safety_risk: 0.02 } });
    const { decision } = await runDecision(supportWorkflow, { text: "What are your hours?" }, { client: jev });
    expect(decision.route).toBe("REVIEW");
    expect(decision.gate.weakest).toBe("wants_money_back");
  });
});

describe("support routing (S-4..S-8)", () => {
  it("S-5 info: AUTO sends template", async () => {
    const { decision, actionResults } = await runDecision(supportWorkflow, { text: "What are your opening hours on Sunday?" }, { client: fastMock() });
    expect(decision.route).toBe("AUTO");
    expect(actionResults[0]).toContain("INFO_GENERAL_v2");
  });

  it("S-4 barrier fault: REVIEW while remote open is off, AUTO once switched on", async () => {
    const text = "The exit barrier at B2 won't lift";
    expect((await runDecision(supportWorkflow, { text }, { client: fastMock() })).decision.route).toBe("REVIEW");
    await freshStore({ autoActions: { barrierRemoteOpen: true } });
    const { decision } = await runDecision(supportWorkflow, { text }, { client: fastMock() });
    expect(decision.route).toBe("AUTO");
    expect(decision.actions.map((a) => a.kind)).toEqual(["open_barrier", "notify_technician"]);
  });

  it("S-7 'other' goes to front desk", async () => {
    const { decision } = await runDecision(supportWorkflow, { text: "hello??" }, { client: fastMock() });
    expect(decision.route).toBe("HUMAN");
    expect(decision.actions[0].kind).toBe("assign_front_desk");
  });
});

describe("F-8 shadow mode and kill switch", () => {
  it("shadow mode decides and logs but runs no actions", async () => {
    await freshStore({ shadowMode: true });
    const { decision, actionResults } = await runDecision(supportWorkflow, { text: "There's smoke in the basement" }, { client: fastMock() });
    expect(decision.status).toBe("shadow");
    expect(actionResults).toEqual([]);
    expect((await listAudit()).filter((e) => e.type === "action")).toEqual([]);
    expect((await listAudit()).find((e) => e.type === "decision")?.shadow).toBe(true);
  });

  it("kill switch routes to HUMAN without calling Jev", async () => {
    await freshStore({ killSwitch: { support: true } });
    const jev = stubJev({ choice: { category: ["info", 0.99] } });
    const { decision } = await runDecision(supportWorkflow, { text: "What are your hours?" }, { client: jev });
    expect(jev.calls).toBe(0);
    expect(decision.route).toBe("HUMAN");
    expect(decision.rule).toBe("KILL-SWITCH");
  });
});

describe("privacy redaction", () => {
  it("masks phone, email, card, plate, UPI but keeps dates and amounts", () => {
    const r = redact(
      "Car TN 09 AB 1234, call 98765 43210 or +91 9876543210, mail a.b@example.com, card 4111 1111 1111 1111, upi ravi@okicici, on 15 Sep 2026 paid ₹1,800",
    );
    expect(r.text).not.toMatch(/TN 09|98765|9876543210|example\.com|4111|okicici/);
    expect(r.text).toContain("15 Sep 2026");
    expect(r.text).toContain("₹1,800");
    expect(r.count).toBe(6);
  });

  it("redacted text is what gets sent to Jev", async () => {
    const { decision } = await runDecision(supportWorkflow, { text: "QR pass not scanning, call 9876543210" }, { client: fastMock() });
    expect(decision.state).toContain("[PHONE]");
    expect(decision.redactions).toBe(1);
  });
});

describe("config (F-6)", () => {
  it("rejects review >= auto", () => {
    expect(validateConfig(mergeConfig(DEFAULT_CONFIG, { thresholds: { review: 0.9, auto: 0.8 } }))).not.toEqual([]);
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
  });
});

describe("HTTP Jev client", () => {
  it("speaks both dialects", () => {
    const v = new HttpJevClient({ dialect: "vercel", apiKey: "k" }).buildBody("s", SUPPORT_QUESTIONS);
    const t = new HttpJevClient({ dialect: "typesafe", apiKey: "k" }).buildBody("s", SUPPORT_QUESTIONS);
    expect(v.model).toBe("typesafe-ai/jev");
    expect((v.questions.is_urgent as { type: string }).type).toBe("boolean");
    expect((t.questions.is_urgent as { type: string }).type).toBe("noul");
    expect((v.questions.category as { criteria: object }).criteria).toHaveProperty("double_charge");
  });

  it("parses both answer shapes", () => {
    const answers = parseAnswers(
      {
        answers: {
          category: { choice: "barrier_fault", confidence: 0.91, probabilities: { barrier_fault: 0.91 } },
          is_urgent: { probability: 0.8 },
          is_safety_risk: { noul: 0.1 },
          wants_money_back: 0.05,
        },
      },
      SUPPORT_QUESTIONS,
    );
    expect(answers.category.value).toBe("barrier_fault");
    expect(answers.is_urgent.value).toBe(true);
    expect(answers.is_safety_risk.confidence).toBeCloseTo(0.9);
  });

  it("reads the real Vercel AI Gateway response (captured 13 Oct 2026), including billed cost", async () => {
    const real = {
      answers: {
        category: {
          type: "choice",
          choice: "barrier_fault",
          probabilities: { double_charge: 0, barrier_fault: 1, info: 0, lost_ticket: 0, pass_issue: 0, penalty_dispute: 0, other: 0 },
          confidence: 1,
        },
        is_urgent: { type: "boolean", probability: 0.97 },
        is_safety_risk: { type: "boolean", probability: 0.38 },
        wants_money_back: { type: "boolean", probability: 0.1 },
      },
      model: "typesafe-ai/jev",
      providerMetadata: { gateway: { cost: "0.000022386" } },
      usage: { inputTokens: 533, outputTokens: 136 },
    };
    const fetchImpl = (async () => new Response(JSON.stringify(real), { status: 200 })) as typeof fetch;
    const client = new HttpJevClient({ dialect: "vercel", apiKey: "k", fetchImpl });
    const res = await client.evaluate("barrier stuck", SUPPORT_QUESTIONS);
    expect(res.answers.category.value).toBe("barrier_fault");
    expect(res.answers.is_safety_risk.confidence).toBeCloseTo(0.62);
    expect(res.inputTokens).toBe(533);
    expect(res.costUsd).toBeCloseTo(0.000022386);

    const { decision } = await runDecision(supportWorkflow, { text: "The exit barrier at B2 won't lift" }, { client });
    expect(decision.costUsd).toBeCloseTo(0.000022386);
    // p(safety)=0.38 is above the default 0.30 trigger, so this barrier message is treated as safety.
    expect(decision.rule).toBe("HR-1 Safety");
  });

  it("an unknown choice or a missing answer is an error (-> HUMAN), never a guess", async () => {
    expect(() => parseAnswers({ answers: { category: { choice: "parking_fee" } } }, SUPPORT_QUESTIONS)).toThrow();
    const fetchImpl = (async () => new Response(JSON.stringify({ result: "?" }), { status: 200 })) as typeof fetch;
    const client = new HttpJevClient({ dialect: "vercel", apiKey: "k", fetchImpl });
    const { decision } = await runDecision(supportWorkflow, { text: "What are your hours?" }, { client });
    expect(decision.route).toBe("HUMAN");
    expect(decision.error).toMatch(/parse/);
  });

  it("429 maps to rate_limit -> HUMAN", async () => {
    const fetchImpl = (async () => new Response("slow down", { status: 429 })) as typeof fetch;
    const client = new HttpJevClient({ dialect: "vercel", apiKey: "k", fetchImpl });
    const { decision } = await runDecision(supportWorkflow, { text: "What are your hours?" }, { client });
    expect(decision.route).toBe("HUMAN");
    expect(decision.error).toMatch(/rate_limit/);
  });
});
