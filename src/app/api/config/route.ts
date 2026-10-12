import { bad, body, json } from "@/lib/api";
import { type Config, type DeepPartial, DEFAULT_CONFIG, mergeConfig, validateConfig } from "@/lib/core/config";
import { appendAudit, getConfig, setConfig, storageKind } from "@/lib/core/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json({ config: await getConfig(), defaults: DEFAULT_CONFIG, provider: process.env.JEV_PROVIDER ?? "mock", storage: storageKind() });
}

export async function PUT(req: Request) {
  const b = await body<{ patch?: DeepPartial<Config>; reset?: boolean; actor?: string }>(req);
  if (!b) return bad("Invalid JSON");
  const before = await getConfig();
  const next = b.reset ? structuredClone(DEFAULT_CONFIG) : mergeConfig(before, b.patch ?? {});
  const errors = validateConfig(next);
  if (errors.length) return bad(errors.join("; "));
  await setConfig(next);
  await appendAudit({
    type: "config_change",
    reason: b.reset ? "Config reset to defaults" : `Config changed: ${JSON.stringify(b.patch)}`,
    actor: b.actor?.trim() || "console",
  });
  return json({ config: next });
}
