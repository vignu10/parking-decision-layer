"use client";

import { useCallback, useEffect, useState } from "react";
import { DecisionCard } from "@/components/DecisionCard";
import { StatusBar } from "@/components/StatusBar";
import { RouteBadge, api, notifyChanged, pct, timeAgo, useConfig } from "@/components/ui";
import type { Decision } from "@/lib/core/types";
import type { AgentSample, SupportSample } from "@/lib/samples";
import type { AgentActionType } from "@/lib/workflows/agentGuard";

interface Metrics {
  total: number;
  routes: Record<"AUTO" | "REVIEW" | "HUMAN" | "BLOCKED", number>;
  automationRate: number;
  open: number;
  overrides: number;
  overrideRate: number;
  errors: number;
  avgLatencyMs: number;
  costUsd: number;
  costPerDecisionUsd: number;
}

type Tab = "support" | "agent";

const ACTION_TYPES: AgentActionType[] = ["refund", "waive_penalty", "open_barrier", "send_message", "resync_pass"];

export default function TriagePage() {
  const { data: cfg } = useConfig();
  const [tab, setTab] = useState<Tab>("support");
  const [samples, setSamples] = useState<{ support: SupportSample[]; agent: AgentSample[] } | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recent, setRecent] = useState<Decision[]>([]);
  const [current, setCurrent] = useState<{ decision: Decision; actionResults?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // support form
  const [text, setText] = useState("");
  // agent form
  const [agent, setAgent] = useState("refund-bot");
  const [request, setRequest] = useState("");
  const [atype, setAtype] = useState<AgentActionType>("refund");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");

  const refresh = useCallback(() => {
    api<Metrics>("/api/metrics").then(setMetrics).catch(() => {});
    api<{ decisions: Decision[] }>("/api/decisions").then((d) => setRecent(d.decisions.slice(0, 25))).catch(() => {});
  }, []);

  useEffect(() => {
    api<{ support: SupportSample[]; agent: AgentSample[] }>("/api/samples").then(setSamples).catch(() => {});
    refresh();
    window.addEventListener("pdl:changed", refresh);
    return () => window.removeEventListener("pdl:changed", refresh);
  }, [refresh]);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res =
        tab === "support"
          ? await api<{ decision: Decision; actionResults: string[] }>("/api/decide/support", {
              method: "POST",
              body: JSON.stringify({ text }),
            })
          : await api<{ decision: Decision; actionResults: string[] }>("/api/decide/agent-guard", {
              method: "POST",
              body: JSON.stringify({
                agent,
                request,
                action: { type: atype, description: desc, amountInr: amount === "" ? undefined : Number(amount) },
              }),
            });
      setCurrent(res);
      notifyChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function loadAgentSample(s: AgentSample) {
    setAgent(s.input.agent ?? "agent");
    setRequest(s.input.request);
    setAtype(s.input.action.type);
    setAmount(s.input.action.amountInr?.toString() ?? "");
    setDesc(s.input.action.description);
  }

  const thresholds = cfg?.config.thresholds ?? { auto: 0.8, review: 0.55 };
  const canRun = tab === "support" ? text.trim().length > 0 : request.trim() && desc.trim();
  const total = metrics?.total || 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Triage</h1>
          <p>Send an item through the decision layer: Jev answers typed questions, our rules decide the route.</p>
        </div>
        <StatusBar />
      </div>

      <div className="metrics">
        <div className="panel metric">
          <div className="k">Decisions</div>
          <div className="v">{total}</div>
          <div className="split">
            {(["AUTO", "REVIEW", "HUMAN", "BLOCKED"] as const).map((r) => (
              <span key={r} className={`band-${r === "BLOCKED" ? "HUMAN" : r}`} style={{ width: `${total ? ((metrics?.routes[r] ?? 0) / total) * 100 : 0}%`, background: r === "BLOCKED" ? "var(--blocked)" : undefined }} />
            ))}
          </div>
        </div>
        <div className="panel metric">
          <div className="k">Automated</div>
          <div className="v">{pct(metrics?.automationRate ?? 0)}</div>
          <div className="s">{metrics?.routes.AUTO ?? 0} with no human touch</div>
        </div>
        <div className="panel metric">
          <div className="k">Open</div>
          <div className="v">{metrics?.open ?? 0}</div>
          <div className="s">awaiting staff</div>
        </div>
        <div className="panel metric">
          <div className="k">Overrides</div>
          <div className="v">{metrics?.overrides ?? 0}</div>
          <div className="s">{pct(metrics?.overrideRate ?? 0)} of resolved</div>
        </div>
        <div className="panel metric">
          <div className="k">Avg latency</div>
          <div className="v">{metrics?.avgLatencyMs ?? 0}<span className="small muted"> ms</span></div>
          <div className="s">{metrics?.errors ?? 0} errors → HUMAN</div>
        </div>
        <div className="panel metric">
          <div className="k">Model cost</div>
          <div className="v">${(metrics?.costUsd ?? 0).toFixed(5)}</div>
          <div className="s">${(metrics?.costPerDecisionUsd ?? 0).toFixed(7)} / decision</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <div className="tabs">
                <button className={tab === "support" ? "on" : ""} onClick={() => setTab("support")}>Support message</button>
                <button className={tab === "agent" ? "on" : ""} onClick={() => setTab("agent")}>Agent action</button>
              </div>
            </div>
            <div className="panel-pad stack">
              {tab === "support" ? (
                <>
                  <label className="field">
                    Customer message
                    <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. The exit barrier at B2 won't lift and I've already paid…" />
                  </label>
                  <div>
                    <div className="section-title" style={{ marginTop: 0 }}>Samples</div>
                    <div className="chips">
                      {samples?.support.map((s) => (
                        <button key={s.id} className="chip" onClick={() => setText(s.input.text)} title={s.input.text}>
                          {s.expected.category.replace("_", " ")} · {s.id}
                        </button>
                      ))}
                      <button className="chip" onClick={() => setText("My car was hit by a reversing SUV near the exit, my friend is hurt [simulate-error]")}>
                        API failure + safety
                      </button>
                      <button className="chip" onClick={() => setText("Barrier at gate 4 won't open [simulate-timeout]")}>timeout</button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label className="field">
                    Customer request (what was actually asked)
                    <textarea className="textarea" style={{ minHeight: 70 }} value={request} onChange={(e) => setRequest(e.target.value)} />
                  </label>
                  <div className="row" style={{ alignItems: "flex-end" }}>
                    <label className="field" style={{ flex: "1 1 140px" }}>
                      Agent
                      <input className="input" value={agent} onChange={(e) => setAgent(e.target.value)} />
                    </label>
                    <label className="field" style={{ flex: "1 1 140px" }}>
                      Action type
                      <select className="select" value={atype} onChange={(e) => setAtype(e.target.value as AgentActionType)}>
                        {ACTION_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field" style={{ flex: "0 1 120px" }}>
                      Amount (₹)
                      <input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
                    </label>
                  </div>
                  <label className="field">
                    Proposed action
                    <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
                  </label>
                  <div>
                    <div className="section-title" style={{ marginTop: 0 }}>Samples</div>
                    <div className="chips">
                      {samples?.agent.map((s) => (
                        <button key={s.id} className="chip" onClick={() => loadAgentSample(s)} title={s.input.action.description}>
                          {s.input.action.type.replace("_", " ")}
                          {s.input.action.amountInr ? ` ₹${s.input.action.amountInr}` : ""} · {s.id}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div className="row">
                <button className="btn btn-primary" disabled={!canRun || busy} onClick={run}>
                  {busy ? "Asking Jev…" : "Run decision"}
                </button>
                {err && <span style={{ color: "var(--blocked)" }}>{err}</span>}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Recent decisions</h2>
              <span className="faint small">click to inspect</span>
            </div>
            {recent.length === 0 ? (
              <div className="empty">Nothing yet. Pick a sample and run it.</div>
            ) : (
              <div className="list">
                {recent.map((d) => (
                  <div key={d.id} className={`list-item${current?.decision.id === d.id ? " sel" : ""}`} onClick={() => setCurrent({ decision: d })}>
                    <RouteBadge route={d.route} />
                    <span className="t">{d.title}</span>
                    <span className="faint small">{timeAgo(d.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          {current ? (
            <DecisionCard decision={current.decision} thresholds={thresholds} actionResults={current.actionResults} />
          ) : (
            <div className="panel empty">
              <h2 style={{ color: "var(--text)", marginBottom: 6 }}>No decision selected</h2>
              Run an item to see Jev&apos;s typed answers, the confidence gate and the route.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
