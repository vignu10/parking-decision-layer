"use client";

import { useCallback, useEffect, useState } from "react";
import { DecisionCard } from "@/components/DecisionCard";
import { RouteBadge, api, notifyChanged, pct, timeAgo, useActor, useConfig, useToast } from "@/components/ui";
import type { Decision } from "@/lib/core/types";

/** Safety first, then urgent, then REVIEW before HUMAN, then oldest first. */
function priority(d: Decision) {
  const safety = d.rule?.includes("Safety") ? 0 : 1;
  const urgent = d.urgent ? 0 : 1;
  return [safety, urgent, new Date(d.createdAt).getTime()];
}

export default function QueuePage() {
  const { data: cfg } = useConfig();
  const [items, setItems] = useState<Decision[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [actor, setActor] = useActor();
  const [busy, setBusy] = useState<string | null>(null);
  const { toast, show } = useToast();

  const load = useCallback(() => {
    api<{ decisions: Decision[] }>("/api/decisions?status=open")
      .then((d) =>
        setItems(
          [...d.decisions].sort((a, b) => {
            const pa = priority(a), pb = priority(b);
            for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
            return 0;
          }),
        ),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function resolve(d: Decision, resolution: "approve" | "reject" | "handled") {
    if (!actor.trim()) {
      show("Enter your name first — every approval is recorded in the audit log.");
      return;
    }
    setBusy(d.id);
    try {
      const r = await api<{ actionResults: string[] }>(`/api/decisions/${d.id}`, {
        method: "POST",
        body: JSON.stringify({ resolution, actor }),
      });
      show(resolution === "approve" ? r.actionResults.join(" · ") || "Approved" : resolution === "reject" ? "Rejected — logged as an override" : "Marked handled");
      notifyChanged();
      load();
    } catch (e) {
      show((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const thresholds = cfg?.config.thresholds ?? { auto: 0.8, review: 0.55 };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Queue</h1>
          <p>Items the layer handed to people. Safety and urgent first. Money moves only after an approval is recorded here.</p>
        </div>
        <label className="field" style={{ width: 240 }}>
          Approving as
          <input className="input" placeholder="Your name" value={actor} onChange={(e) => setActor(e.target.value)} />
        </label>
      </div>

      <div className="panel">
        {items.length === 0 ? (
          <div className="empty">Queue is clear.</div>
        ) : (
          items.map((d) => {
            const approvable = d.actions.some((a) => a.when === "on_approval");
            return (
              <div key={d.id} className="qcard">
                <div className="row">
                  <RouteBadge route={d.route} />
                  {d.rule && <span className="pill pill-danger">{d.rule}</span>}
                  {d.urgent && <span className="urgent-flag">URGENT</span>}
                  <span className="pill">{d.workflow === "support" ? "Support" : "Agent guard"}</span>
                  {d.category && <span className="pill">{d.category}</span>}
                  <span className="spacer" />
                  <span className="faint small">
                    conf {pct(d.gate.confidence)} · {timeAgo(d.createdAt)}
                  </span>
                </div>
                <div style={{ fontWeight: 550 }}>{d.title}</div>
                <div className="muted small">{d.reason}</div>
                {approvable && (
                  <div className="small">
                    <span className="when">suggested</span>{" "}
                    {d.actions.filter((a) => a.when === "on_approval").map((a) => a.label).join("; ")}
                  </div>
                )}
                <div className="row">
                  {approvable ? (
                    <>
                      <button className="btn btn-sm btn-good" disabled={busy === d.id} onClick={() => resolve(d, "approve")}>
                        Approve &amp; execute
                      </button>
                      <button className="btn btn-sm btn-bad" disabled={busy === d.id} onClick={() => resolve(d, "reject")}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-sm" disabled={busy === d.id} onClick={() => resolve(d, "handled")}>
                      Mark handled
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => setOpen(open === d.id ? null : d.id)}>
                    {open === d.id ? "Hide details" : "Details"}
                  </button>
                </div>
                {open === d.id && <DecisionCard decision={d} thresholds={thresholds} />}
              </div>
            );
          })
        )}
      </div>
      {toast}
    </>
  );
}
