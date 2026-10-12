/**
 * PRD §12 — pilot acceptance criteria (support desk + agent guard scope).
 * AC3 (critical alerts) belongs to the Alerts workflow, which is out of scope for this build.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resolveDecision, runDecision } from "@/lib/core/engine";
import { listAudit } from "@/lib/core/store";
import { DEFAULT_CONFIG } from "@/lib/core/config";
import { runEvaluation } from "@/lib/evaluate";
import { AGENT_SAMPLES, SUPPORT_SAMPLES } from "@/lib/samples";
import { agentGuardWorkflow } from "@/lib/workflows/agentGuard";
import { supportWorkflow } from "@/lib/workflows/support";
import { failingJev, fastMock, freshStore, hangingJev, stubJev } from "./helpers";

const MONEY_KINDS = ["queue_refund", "prepare_waiver"];

beforeEach(async () => {
  await freshStore();
});

describe("AC1 — safety messages always page security and reach a person", () => {
  const safetyTexts = [
    "There's smoke coming from a car near pillar C14",
    "My kid is locked inside the car and it's very hot",
    "Someone fell down the ramp and is bleeding",
    "A man is threatening the attendant at exit 2",
  ];

  it.each(safetyTexts)("model flags it: %s", async (text) => {
    const { decision, actionResults } = await runDecision(supportWorkflow, { text }, { client: fastMock() });
    expect(decision.route).toBe("HUMAN");
    expect(decision.rule).toContain("Safety");
    expect(decision.actions.map((a) => a.kind)).toEqual(["page_security_lead", "assign_duty_manager"]);
    expect(actionResults.some((r) => r.includes("Paged security lead"))).toBe(true);
  });

  it("even when Jev is very confident it is NOT safety, our keyword rule still catches it", async () => {
    const jev = stubJev({ choice: { category: ["barrier_fault", 0.97] }, noul: { is_safety_risk: 0.02 } });
    const { decision } = await runDecision(supportWorkflow, { text: "Barrier came down on my car, I think my arm is injured" }, { client: jev });
    expect(decision.route).toBe("HUMAN");
    expect(decision.rule).toBe("HR-1 Safety");
  });

  it("a weak safety signal (p ≥ trigger, model says no) still counts as safety", async () => {
    const jev = stubJev({ choice: { category: ["info", 0.95] }, noul: { is_safety_risk: 0.35 } });
    const { decision } = await runDecision(supportWorkflow, { text: "Is the basement level open?" }, { client: jev });
    expect(decision.route).toBe("HUMAN");
    expect(decision.rule).toBe("HR-1 Safety");
  });

  it("when Jev is down, a safety message still pages security", async () => {
    const { decision } = await runDecision(supportWorkflow, { text: "fire near level 3 stairwell" }, { client: failingJev() });
    expect(decision.route).toBe("HUMAN");
    expect(decision.rule).toContain("HR-1 Safety");
    expect(decision.actions[0].kind).toBe("page_security_lead");
  });
});

describe("AC2 — no refund or penalty waiver executes without a recorded approval", () => {
  it("money is never in a 'now' action, for any sample, even at maximum confidence", async () => {
    const jevs = [
      stubJev({ choice: { category: ["double_charge", 0.99] }, noul: { wants_money_back: 0.99 } }),
      stubJev({ choice: { category: ["penalty_dispute", 0.99] }, noul: { wants_money_back: 0.99 } }),
      stubJev({ choice: { category: ["info", 0.99] }, noul: { wants_money_back: 0.99 } }),
      fastMock(),
    ];
    for (const client of jevs) {
      for (const s of SUPPORT_SAMPLES) {
        const { decision } = await runDecision(supportWorkflow, s.input, { client });
        const nowMoney = decision.actions.filter((a) => a.when === "now" && MONEY_KINDS.includes(a.kind));
        expect(nowMoney).toEqual([]);
        // the three stubs all signal money, so none of their items may be AUTO
        if (client.name === "jev:stub") expect(decision.route).not.toBe("AUTO");
      }
    }
    const executedMoney = (await listAudit()).filter((e) => e.type === "action" && MONEY_KINDS.includes(String(e.detail?.kind)));
    expect(executedMoney).toEqual([]);
  });

  it("agent refunds within the limit still need approval by default", async () => {
    const jev = stubJev({ noul: { violates_policy: 0.01, matches_request: 0.99 } });
    const { decision } = await runDecision(agentGuardWorkflow, AGENT_SAMPLES[0].input, { client: jev });
    expect(decision.route).toBe("REVIEW");
    expect(decision.actions.every((a) => a.when === "on_approval")).toBe(true);
  });

  it("money executes only after approval, and the approval is logged first with the approver", async () => {
    const { decision } = await runDecision(supportWorkflow, SUPPORT_SAMPLES[0].input, { client: fastMock() });
    expect(decision.route).toBe("REVIEW");
    await expect(resolveDecision(decision.id, "approve", "  ")).rejects.toThrow(/approver/);

    await resolveDecision(decision.id, "approve", "Priya (support lead)");
    const events = (await listAudit()).filter((e) => e.decisionId === decision.id);
    const approvalIdx = events.findIndex((e) => e.type === "approval");
    const refundIdx = events.findIndex((e) => e.type === "action" && e.detail?.kind === "queue_refund");
    expect(approvalIdx).toBeGreaterThan(-1);
    expect(refundIdx).toBeGreaterThan(approvalIdx);
    expect(events[approvalIdx].actor).toBe("Priya (support lead)");
    await expect(resolveDecision(decision.id, "approve", "Priya")).rejects.toThrow(/already/);
  });
});

describe("AC4 — agent actions that violate policy or mismatch the request are blocked", () => {
  it("blocks every labelled bad action", async () => {
    for (const s of AGENT_SAMPLES.filter((x) => x.expected.route === "BLOCKED")) {
      const { decision } = await runDecision(agentGuardWorkflow, s.input, { client: fastMock() });
      expect(decision.route, s.id).toBe("BLOCKED");
      expect(decision.actions.map((a) => a.kind)).toEqual(["block_agent_action"]);
    }
  });

  it("blocks even on a weak 'violates' lean, and on a mismatch", async () => {
    const weak = stubJev({ noul: { violates_policy: 0.52, matches_request: 0.99 } });
    expect((await runDecision(agentGuardWorkflow, AGENT_SAMPLES[4].input, { client: weak })).decision.route).toBe("BLOCKED");
    const mismatch = stubJev({ noul: { violates_policy: 0.01, matches_request: 0.3 } });
    expect((await runDecision(agentGuardWorkflow, AGENT_SAMPLES[4].input, { client: mismatch })).decision.route).toBe("BLOCKED");
  });

  it("refunds above the limit need approval (D-10)", async () => {
    await freshStore({ agentGuard: { autoExecuteSmallRefunds: true } });
    const jev = stubJev({ noul: { violates_policy: 0.01, matches_request: 0.99 } });
    const over = await runDecision(agentGuardWorkflow, AGENT_SAMPLES[1].input, { client: jev });
    expect(over.decision.route).toBe("REVIEW");
    expect(over.decision.rule).toBe("D-10 Over refund limit");
    const under = await runDecision(agentGuardWorkflow, AGENT_SAMPLES[0].input, { client: jev });
    expect(under.decision.route).toBe("AUTO"); // only when the D-10 switch is explicitly on
  });
});

describe("AC5 — on API failure or timeout, every item routes to a person", () => {
  it.each(["http", "rate_limit", "network", "parse"] as const)("%s error -> HUMAN, never AUTO", async (kind) => {
    for (const s of SUPPORT_SAMPLES) {
      const { decision } = await runDecision(supportWorkflow, s.input, { client: failingJev(kind) });
      expect(decision.route).toBe("HUMAN");
      expect(decision.error).toContain(kind);
      expect(decision.actions.every((a) => !MONEY_KINDS.includes(a.kind) && a.kind !== "send_template")).toBe(true);
    }
    for (const s of AGENT_SAMPLES) {
      const { decision } = await runDecision(agentGuardWorkflow, s.input, { client: failingJev(kind) });
      expect(decision.route).toBe("HUMAN");
      expect(decision.actions.every((a) => a.when === "on_approval")).toBe(true);
    }
  });

  it("timeout -> HUMAN", async () => {
    await freshStore({ timeoutMs: 100 });
    const { decision } = await runDecision(supportWorkflow, { text: "What are your hours?" }, { client: hangingJev });
    expect(decision.route).toBe("HUMAN");
    expect(decision.error).toMatch(/timeout/);
    expect(decision.rule).toBe("HR-5 Model/API failure");
  });
});

describe("AC6 — every decision and action is in the audit log with confidence and reason", () => {
  it("logs decisions and actions", async () => {
    const results = [];
    for (const s of SUPPORT_SAMPLES) results.push((await runDecision(supportWorkflow, s.input, { client: fastMock() })).decision);
    for (const s of AGENT_SAMPLES) results.push((await runDecision(agentGuardWorkflow, s.input, { client: fastMock() })).decision);
    const audit = (await listAudit());
    for (const d of results) {
      const ev = audit.find((e) => e.decisionId === d.id && e.type === "decision");
      expect(ev, d.id).toBeDefined();
      expect(ev!.reason.length).toBeGreaterThan(0);
      expect(ev).toHaveProperty("confidence");
      expect(ev!.route).toBe(d.route);
      const nowActions = d.actions.filter((a) => a.when === "now").length;
      expect(audit.filter((e) => e.decisionId === d.id && e.type === "action").length).toBe(nowActions);
    }
    // append-only: events are frozen
    expect(Object.isFrozen(audit[0])).toBe(true);
  });
});

describe("AC7 — offline AUTO-band agreement meets target before real actions", () => {
  it("mock run meets the 95% AUTO-band target with zero safety/money disagreements", async () => {
    const r = await runEvaluation(DEFAULT_CONFIG, fastMock());
    expect(r.byBand.AUTO.rate).toBeGreaterThanOrEqual(0.95);
    expect(r.safetyOrMoneyDisagreements).toBe(0);
  });
});
