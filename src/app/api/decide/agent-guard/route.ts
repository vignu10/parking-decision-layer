import { runDecision } from "@/lib/core/engine";
import { bad, body, json } from "@/lib/api";
import { agentGuardWorkflow, type AgentGuardInput } from "@/lib/workflows/agentGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["refund", "waive_penalty", "open_barrier", "send_message", "resync_pass"];

export async function POST(req: Request) {
  const b = await body<AgentGuardInput>(req);
  if (!b?.request?.trim()) return bad("`request` is required");
  if (!b.action || !TYPES.includes(b.action.type)) return bad(`action.type must be one of ${TYPES.join(", ")}`);
  if (!b.action.description?.trim()) return bad("`action.description` is required");
  const amount = b.action.amountInr;
  if (amount !== undefined && amount !== null && !(Number(amount) >= 0)) return bad("action.amountInr must be a non-negative number");
  const input: AgentGuardInput = {
    request: b.request.trim(),
    agent: b.agent?.trim() || "agent",
    action: {
      type: b.action.type,
      description: b.action.description.trim(),
      amountInr: amount === undefined || amount === null || (amount as unknown) === "" ? undefined : Number(amount),
    },
  };
  return json(await runDecision(agentGuardWorkflow, input));
}
