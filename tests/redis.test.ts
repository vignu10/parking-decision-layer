/**
 * The Redis backend against a tiny in-process emulation of Upstash's REST /pipeline API,
 * so the hosted (Vercel) storage path is tested without a network.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveDecision, runDecision } from "@/lib/core/engine";
import { __resetStore, getConfig, listAudit, listDecisions, setConfig, storageKind } from "@/lib/core/store";
import { DEFAULT_CONFIG } from "@/lib/core/config";
import { SUPPORT_SAMPLES } from "@/lib/samples";
import { supportWorkflow } from "@/lib/workflows/support";
import { fastMock } from "./helpers";

const kv = new Map<string, string>();
const lists = new Map<string, string[]>();
let calls = 0;

function exec(c: (string | number)[]): unknown {
  const [op, key, ...rest] = c.map(String);
  const list = () => lists.get(key) ?? (lists.set(key, []), lists.get(key)!);
  const idx = (i: number, n: number) => (i < 0 ? n + i : i);
  switch (op) {
    case "GET": return kv.get(key) ?? null;
    case "SET": kv.set(key, rest[0]); return "OK";
    case "INCR": { const v = Number(kv.get(key) ?? 0) + 1; kv.set(key, String(v)); return v; }
    case "MGET": return [key, ...rest].map((k) => kv.get(k) ?? null);
    case "LPUSH": list().unshift(...rest.reverse()); return list().length;
    case "RPUSH": list().push(...rest); return list().length;
    case "LTRIM": { const l = list(); const n = l.length; lists.set(key, l.slice(idx(+rest[0], n), idx(+rest[1], n) + 1)); return "OK"; }
    case "LRANGE": { const l = list(); const n = l.length; return l.slice(Math.max(0, idx(+rest[0], n)), idx(+rest[1], n) + 1); }
    default: throw new Error(`unsupported ${op}`);
  }
}

beforeAll(() => {
  vi.stubEnv("KV_REST_API_URL", "https://fake-upstash.example");
  vi.stubEnv("KV_REST_API_TOKEN", "t");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls++;
    expect(url).toBe("https://fake-upstash.example/pipeline");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    const cmds = JSON.parse(String(init.body)) as (string | number)[][];
    return new Response(JSON.stringify(cmds.map((c) => ({ result: exec(c) }))), { status: 200 });
  });
  __resetStore(true);
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __resetStore();
});

describe("Redis storage (Vercel)", () => {
  it("is selected from KV_REST_API_* env vars", () => {
    expect(storageKind()).toBe("redis");
  });

  it("round-trips config, decisions, approvals and the audit log", async () => {
    expect(await getConfig()).toEqual(DEFAULT_CONFIG);
    await setConfig({ ...DEFAULT_CONFIG, shadowMode: false, thresholds: { auto: 0.85, review: 0.6 } });
    expect((await getConfig()).thresholds.auto).toBe(0.85);

    const a = await runDecision(supportWorkflow, SUPPORT_SAMPLES[0].input, { client: fastMock() }); // refund -> REVIEW
    const b = await runDecision(supportWorkflow, SUPPORT_SAMPLES[3].input, { client: fastMock() }); // info -> AUTO

    // A different "instance" (fresh module state, same Redis) sees everything.
    __resetStore(true);
    const ds = await listDecisions();
    expect(ds.map((d) => d.id)).toEqual([b.decision.id, a.decision.id]);

    await resolveDecision(a.decision.id, "approve", "Vignu");
    const after = (await listDecisions()).find((d) => d.id === a.decision.id)!;
    expect(after.status).toBe("approved");
    expect((await listDecisions()).length).toBe(2); // update did not duplicate the index

    const audit = await listAudit();
    expect(audit.map((e) => e.seq)).toEqual(audit.map((_, i) => i + 1));
    expect(audit.some((e) => e.type === "approval" && e.actor === "Vignu")).toBe(true);
    expect(audit.some((e) => e.type === "action" && e.detail?.kind === "queue_refund")).toBe(true);
    expect(calls).toBeGreaterThan(0);
  });
});
