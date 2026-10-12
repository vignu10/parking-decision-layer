import { runDecision } from "@/lib/core/engine";
import { bad, body, json } from "@/lib/api";
import { supportWorkflow, type SupportInput } from "@/lib/workflows/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await body<SupportInput>(req);
  const text = b?.text?.trim();
  if (!text) return bad("`text` is required");
  if (text.length > 4000) return bad("`text` is too long (max 4000 chars)");
  const result = await runDecision(supportWorkflow, { text, channel: b?.channel, site: b?.site });
  return json(result);
}
