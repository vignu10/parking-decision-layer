import { type Config, DEFAULT_CONFIG, mergeConfig, type DeepPartial } from "@/lib/core/config";
import { __resetStore, setConfig } from "@/lib/core/store";
import { MockJevClient } from "@/lib/jev/mock";
import { type Answers, type JevClient, type Question, JevError, noulAnswer } from "@/lib/jev/types";

/** Stub Jev: you set exactly what it answers. */
export function stubJev(spec: { choice?: Record<string, [string, number]>; noul?: Record<string, number> }): JevClient & { calls: number } {
  return {
    name: "jev:stub",
    calls: 0,
    async evaluate(_state: string, questions: Question[]) {
      this.calls++;
      const answers: Answers = {};
      for (const q of questions) {
        if (q.type === "choice") {
          const [value, confidence] = spec.choice?.[q.id] ?? ["other", 0.5];
          answers[q.id] = { id: q.id, type: "choice", value, confidence, probabilities: { [value]: confidence } };
        } else {
          answers[q.id] = noulAnswer(q.id, spec.noul?.[q.id] ?? 0.05);
        }
      }
      return { answers, inputTokens: 100, latencyMs: 1, provider: "jev:stub" };
    },
  };
}

export const failingJev = (kind: JevError["kind"] = "http"): JevClient => ({
  name: "jev:failing",
  async evaluate() {
    throw new JevError("boom", kind);
  },
});

export const hangingJev: JevClient = {
  name: "jev:hanging",
  evaluate: () => new Promise(() => {}),
};

export const fastMock = () => new MockJevClient([0, 0]);

export async function freshStore(patch: DeepPartial<Config> = {}): Promise<Config> {
  __resetStore();
  const cfg = mergeConfig(DEFAULT_CONFIG, patch);
  await setConfig(cfg);
  return cfg;
}
