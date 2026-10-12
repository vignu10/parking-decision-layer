"use client";

import type { Config } from "@/lib/core/config";
import type { Decision } from "@/lib/core/types";
import { ConfidenceMeter, MiniBar, RouteBadge, bandOf, pct } from "./ui";

const STATUS_LABEL: Record<Decision["status"], string> = {
  executed: "Actions executed",
  pending_approval: "Waiting for staff approval",
  assigned: "With a person",
  blocked: "Blocked",
  shadow: "Shadow mode — logged only, no actions taken",
  approved: "Approved by staff",
  rejected: "Rejected by staff (override)",
  handled: "Handled by staff",
};

export function DecisionCard({
  decision: d,
  thresholds,
  actionResults,
}: {
  decision: Decision;
  thresholds: Config["thresholds"];
  actionResults?: string[];
}) {
  const answers = d.answers ? Object.values(d.answers) : [];
  return (
    <div className="panel">
      <div className="panel-pad">
        <div className="decision-top">
          <div style={{ minWidth: 0 }}>
            <div className="row">
              <RouteBadge route={d.route} large />
              {d.rule && <span className="pill pill-danger">{d.rule}</span>}
              {d.urgent && <span className="urgent-flag">URGENT</span>}
              {d.shadow && <span className="pill pill-warn">shadow</span>}
            </div>
            <p className="reason">{d.reason}</p>
          </div>
        </div>

        <div className="section-title">Decision confidence (weakest gating question)</div>
        <ConfidenceMeter value={d.gate.confidence} thresholds={thresholds} />
        <p className="small muted" style={{ margin: "6px 0 0" }}>
          {d.gate.confidence === null
            ? "No model confidence — Jev was not called or failed."
            : `${pct(d.gate.confidence)} set by `}
          {d.gate.weakest && d.gate.confidence !== null && <code>{d.gate.weakest}</code>}
          {d.gate.confidence !== null && ` · gating: ${d.gate.questions.join(", ")}`}
        </p>

        {answers.length > 0 && (
          <>
            <div className="section-title">Jev answers</div>
            <div className="answers">
              {answers.map((a) => (
                <div key={a.id} className={`answer${a.id === d.gate.weakest ? " weakest" : ""}`}>
                  <span className="name">{a.id}</span>
                  <div>
                    <div className="val">{a.type === "choice" ? a.value : a.value ? "yes" : "no"}</div>
                    <MiniBar value={a.confidence} band={bandOf(a.confidence, thresholds)} />
                  </div>
                  <span className="pct">{pct(a.confidence)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="section-title">Actions</div>
        {d.actions.length === 0 ? (
          <p className="muted small">None.</p>
        ) : (
          <ul className="actions-list">
            {d.actions.map((a, i) => (
              <li key={i}>
                <span className="when">{a.when === "now" ? (d.shadow ? "would run" : "ran") : "on approval"}</span>
                {a.label}
              </li>
            ))}
          </ul>
        )}
        {actionResults && actionResults.length > 0 && (
          <div className="state-box" style={{ marginTop: 8 }}>
            {actionResults.join("\n")}
          </div>
        )}

        <div className="section-title">Details</div>
        <dl className="kv">
          <dt>Status</dt>
          <dd>{STATUS_LABEL[d.status]}{d.resolvedBy ? ` · ${d.resolvedBy}` : ""}</dd>
          <dt>Category</dt>
          <dd>{d.category ?? "—"}</dd>
          <dt>Provider</dt>
          <dd>
            <code>{d.provider}</code> · {d.latencyMs} ms · {d.inputTokens} tokens · ${d.costUsd.toFixed(7)}
          </dd>
          {d.error && (
            <>
              <dt>Error</dt>
              <dd style={{ color: "var(--blocked)" }}>{d.error}</dd>
            </>
          )}
          <dt>Decision ID</dt>
          <dd>
            <code>{d.id}</code>
          </dd>
        </dl>

        <div className="section-title">
          Sent to Jev {d.redactions > 0 && <span className="pill pill-ok" style={{ marginLeft: 6 }}>{d.redactions} redacted</span>}
        </div>
        <div className="state-box">{d.state}</div>
      </div>
    </div>
  );
}
