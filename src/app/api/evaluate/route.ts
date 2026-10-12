import { json } from "@/lib/api";
import { getConfig } from "@/lib/core/store";
import { runEvaluation } from "@/lib/evaluate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  return json(await runEvaluation(await getConfig()));
}
