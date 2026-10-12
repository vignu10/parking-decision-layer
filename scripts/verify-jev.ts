/**
 * PRD §10 "Assumptions to validate": confirm the real request/response shape with ONE real call.
 *
 *   JEV_PROVIDER=vercel AI_GATEWAY_API_KEY=... npm run verify:jev
 *
 * Prints the request body, the raw response and how our parser reads it.
 * If parsing fails, adjust parseAnswers() in src/lib/jev/http.ts to match the raw response.
 */
import fs from "node:fs";
import { HttpJevClient, type Dialect } from "../src/lib/jev/http";
import { SUPPORT_QUESTIONS } from "../src/lib/workflows/support";

// Load .env.local / .env the way Next.js does, without overriding variables already set.
for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const provider = (process.env.JEV_PROVIDER ?? "vercel") as Dialect;
  if (provider !== "vercel" && provider !== "typesafe") {
    console.error("Set JEV_PROVIDER=vercel or JEV_PROVIDER=typesafe");
    process.exit(1);
  }
  const client = new HttpJevClient({
    dialect: provider,
    url: process.env.JEV_BASE_URL || undefined,
    model: process.env.JEV_MODEL || undefined,
  });
  const state = "The exit barrier at level B2 won't lift. I've already paid and there's a queue behind me.";
  console.log("Request body:\n", JSON.stringify(client.buildBody(state, SUPPORT_QUESTIONS), null, 2));
  try {
    const res = await client.evaluate(state, SUPPORT_QUESTIONS);
    console.log("\nRaw response:\n", JSON.stringify(res.raw, null, 2));
    console.log("\nParsed answers:\n", JSON.stringify(res.answers, null, 2));
    console.log(`\nOK — ${res.latencyMs} ms, ${res.inputTokens} input tokens`);
  } catch (e) {
    console.error("\nFAILED:", (e as Error).message);
    const raw = (e as { raw?: unknown }).raw;
    if (raw !== undefined) console.error("\nRaw response:\n", JSON.stringify(raw, null, 2));
    console.error("Compare the raw response with parseAnswers() in src/lib/jev/http.ts.");
    process.exit(1);
  }
}

main();
