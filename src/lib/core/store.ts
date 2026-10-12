import fs from "node:fs";
import path from "node:path";
import { type Config, DEFAULT_CONFIG } from "./config";
import type { AuditEvent, Decision } from "./types";

/**
 * Storage for config, decisions and the append-only audit log (F-5).
 *
 * Two backends behind one async interface:
 *  - Redis (Upstash REST) when KV_REST_API_URL/KV_REST_API_TOKEN or
 *    UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are set. Needed on Vercel, where
 *    each serverless function has its own memory.
 *  - In-memory otherwise (local dev, tests).
 *
 * The audit log has no update or delete path in either backend. Production should use a
 * database with an append-only audit table and the agreed retention policy.
 */

interface Backend {
  readonly kind: "memory" | "redis";
  getConfig(): Promise<Config | null>;
  setConfig(c: Config): Promise<void>;
  saveDecision(d: Decision, isNew: boolean): Promise<void>;
  getDecision(id: string): Promise<Decision | undefined>;
  listDecisions(limit: number): Promise<Decision[]>;
  appendAudit(e: Omit<AuditEvent, "seq" | "ts">): Promise<AuditEvent>;
  /** Oldest first, most recent `limit` events. */
  listAudit(limit: number): Promise<AuditEvent[]>;
}

// ---------------------------------------------------------------- memory

interface MemState {
  config: Config | null;
  decisions: Map<string, Decision>;
  audit: AuditEvent[];
  seq: number;
}

class MemoryBackend implements Backend {
  readonly kind = "memory" as const;
  private get s(): MemState {
    const g = globalThis as unknown as { __pdlState?: MemState };
    return (g.__pdlState ??= { config: null, decisions: new Map(), audit: [], seq: 0 });
  }
  async getConfig() {
    return this.s.config ? structuredClone(this.s.config) : null;
  }
  async setConfig(c: Config) {
    this.s.config = structuredClone(c);
  }
  async saveDecision(d: Decision) {
    this.s.decisions.set(d.id, structuredClone(d));
  }
  async getDecision(id: string) {
    const d = this.s.decisions.get(id);
    return d ? structuredClone(d) : undefined;
  }
  async listDecisions(limit: number) {
    return [...this.s.decisions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((d) => structuredClone(d));
  }
  async appendAudit(e: Omit<AuditEvent, "seq" | "ts">) {
    const event: AuditEvent = Object.freeze({ ...e, seq: ++this.s.seq, ts: new Date().toISOString() });
    this.s.audit.push(event);
    return event;
  }
  async listAudit(limit: number) {
    return this.s.audit.slice(-limit);
  }
}

// ---------------------------------------------------------------- redis (Upstash REST)

const K = {
  config: "pdl:config",
  decision: (id: string) => `pdl:decision:${id}`,
  decisions: "pdl:decisions",
  audit: "pdl:audit",
  seq: "pdl:audit:seq",
};
const MAX_DECISION_INDEX = 2000;

class RedisBackend implements Backend {
  readonly kind = "redis" as const;
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async pipeline(cmds: (string | number)[][]): Promise<unknown[]> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const err = out.find((r) => r.error);
    if (err) throw new Error(`Redis error: ${err.error}`);
    return out.map((r) => r.result);
  }
  private async cmd(...c: (string | number)[]) {
    return (await this.pipeline([c]))[0];
  }

  async getConfig() {
    const v = (await this.cmd("GET", K.config)) as string | null;
    return v ? (JSON.parse(v) as Config) : null;
  }
  async setConfig(c: Config) {
    await this.cmd("SET", K.config, JSON.stringify(c));
  }
  async saveDecision(d: Decision, isNew: boolean) {
    const cmds: (string | number)[][] = [["SET", K.decision(d.id), JSON.stringify(d)]];
    if (isNew) cmds.push(["LPUSH", K.decisions, d.id], ["LTRIM", K.decisions, 0, MAX_DECISION_INDEX - 1]);
    await this.pipeline(cmds);
  }
  async getDecision(id: string) {
    const v = (await this.cmd("GET", K.decision(id))) as string | null;
    return v ? (JSON.parse(v) as Decision) : undefined;
  }
  async listDecisions(limit: number) {
    const ids = (await this.cmd("LRANGE", K.decisions, 0, limit - 1)) as string[];
    if (!ids.length) return [];
    const vals = (await this.cmd("MGET", ...ids.map(K.decision))) as (string | null)[];
    return vals.filter((v): v is string => !!v).map((v) => JSON.parse(v) as Decision);
  }
  async appendAudit(e: Omit<AuditEvent, "seq" | "ts">) {
    const seq = Number(await this.cmd("INCR", K.seq));
    const event: AuditEvent = { ...e, seq, ts: new Date().toISOString() };
    await this.cmd("RPUSH", K.audit, JSON.stringify(event));
    return Object.freeze(event);
  }
  async listAudit(limit: number) {
    const vals = (await this.cmd("LRANGE", K.audit, -limit, -1)) as string[];
    return vals.map((v) => JSON.parse(v) as AuditEvent).sort((a, b) => a.seq - b.seq);
  }
}

// ---------------------------------------------------------------- selection

let backend: Backend | null = null;

function pick(): Backend {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new RedisBackend(url, token) : new MemoryBackend();
}

function db(): Backend {
  return (backend ??= pick());
}

export function storageKind(): "memory" | "redis" {
  return db().kind;
}

export async function getConfig(): Promise<Config> {
  const c = await db().getConfig();
  // Fill any keys added since the config was saved.
  return c ? { ...structuredClone(DEFAULT_CONFIG), ...c } : structuredClone(DEFAULT_CONFIG);
}

export async function setConfig(c: Config) {
  await db().setConfig(c);
}

export async function saveDecision(d: Decision, isNew = true) {
  await db().saveDecision(d, isNew);
}

export async function getDecision(id: string) {
  return db().getDecision(id);
}

export async function listDecisions(limit = 300) {
  return db().listDecisions(limit);
}

export async function appendAudit(e: Omit<AuditEvent, "seq" | "ts">): Promise<AuditEvent> {
  const event = await db().appendAudit(e);
  const file = process.env.AUDIT_LOG_FILE;
  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(event) + "\n");
    } catch {
      /* best effort in dev; never block a decision on log file I/O */
    }
  }
  return event;
}

export async function listAudit(limit = 1000): Promise<readonly AuditEvent[]> {
  return db().listAudit(limit);
}

/** Tests only: fresh in-memory store, or re-read the env to pick Redis. */
export function __resetStore(fromEnv = false) {
  (globalThis as unknown as { __pdlState?: unknown }).__pdlState = undefined;
  backend = fromEnv ? pick() : new MemoryBackend();
}
