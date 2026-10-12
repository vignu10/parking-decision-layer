import { json } from "@/lib/api";
import { AGENT_SAMPLES, SUPPORT_SAMPLES } from "@/lib/samples";

export const dynamic = "force-static";

export async function GET() {
  return json({ support: SUPPORT_SAMPLES, agent: AGENT_SAMPLES });
}
