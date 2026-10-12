import { HttpJevClient } from "./http";
import { MockJevClient } from "./mock";
import type { JevClient } from "./types";

export * from "./types";

/**
 * Pick the Jev backend from JEV_PROVIDER (mock | vercel | typesafe).
 * The interface is the same either way, so swapping providers (PRD §11 vendor risk)
 * never touches the decision layer.
 */
export function createJevClient(provider = process.env.JEV_PROVIDER ?? "mock"): JevClient {
  switch (provider) {
    case "vercel":
    case "typesafe":
      return new HttpJevClient({
        dialect: provider,
        url: process.env.JEV_BASE_URL || undefined,
        model: process.env.JEV_MODEL || undefined,
      });
    case "mock":
    default:
      return new MockJevClient();
  }
}
