import { json } from "@/lib/api";
import { listAudit, listDecisions } from "@/lib/core/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** NFR operability: volume, route split, confidence distribution, overrides, errors, cost. */
export async function GET() {
  const ds = await listDecisions(2000);
  const audit = await listAudit(5000);
  const routes = { AUTO: 0, REVIEW: 0, HUMAN: 0, BLOCKED: 0 };
  const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i / 10, count: 0 }));
  let cost = 0, latency = 0, latencyN = 0, errors = 0, shadow = 0;
  for (const d of ds) {
    routes[d.route]++;
    cost += d.costUsd;
    if (d.error) errors++;
    if (d.shadow) shadow++;
    if (d.latencyMs) { latency += d.latencyMs; latencyN++; }
    if (d.gate.confidence !== null) buckets[Math.min(9, Math.floor(d.gate.confidence * 10))].count++;
  }
  const approvals = audit.filter((e) => e.type === "approval").length;
  const rejections = audit.filter((e) => e.type === "rejection").length;
  const resolved = approvals + rejections;
  return json({
    total: ds.length,
    routes,
    automationRate: ds.length ? routes.AUTO / ds.length : 0,
    open: ds.filter((d) => d.status === "pending_approval" || d.status === "assigned").length,
    approvals,
    overrides: rejections,
    overrideRate: resolved ? rejections / resolved : 0,
    errors,
    shadow,
    avgLatencyMs: latencyN ? Math.round(latency / latencyN) : 0,
    costUsd: cost,
    costPerDecisionUsd: ds.length ? cost / ds.length : 0,
    confidence: buckets,
  });
}
