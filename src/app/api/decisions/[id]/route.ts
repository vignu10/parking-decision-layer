import { bad, body, json } from "@/lib/api";
import { type Resolution, resolveDecision } from "@/lib/core/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body<{ resolution: Resolution; actor: string }>(req);
  if (!b || !["approve", "reject", "handled"].includes(b.resolution)) return bad("resolution must be approve | reject | handled");
  try {
    return json(await resolveDecision(id, b.resolution, b.actor));
  } catch (e) {
    return bad((e as Error).message, 409);
  }
}
