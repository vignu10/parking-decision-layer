import { json } from "@/lib/api";
import { listDecisions } from "@/lib/core/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  let rows = await listDecisions(300);
  if (status === "open") rows = rows.filter((d) => d.status === "pending_approval" || d.status === "assigned");
  else if (status) rows = rows.filter((d) => d.status === status);
  return json({ decisions: rows.slice(0, 300) });
}
