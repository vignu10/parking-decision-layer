import { json } from "@/lib/api";
import { listAudit } from "@/lib/core/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json({ events: [...(await listAudit(1000))].reverse().slice(0, 1000) });
}
