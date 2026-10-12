"use client";

import { useEffect, useState } from "react";
import { ConfidenceMeter, api, notifyChanged, useActor, useConfig, useToast } from "@/components/ui";
import type { Config, DeepPartial } from "@/lib/core/config";

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export default function SettingsPage() {
  const { data, reload } = useConfig();
  const [draft, setDraft] = useState<Config | null>(null);
  const [actor] = useActor();
  const { toast, show } = useToast();

  useEffect(() => {
    if (data) setDraft(structuredClone(data.config));
  }, [data]);

  if (!draft || !data) return <div className="empty">Loading…</div>;

  async function save(patch: DeepPartial<Config>, label: string) {
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify({ patch, actor: actor || "console" }) });
      show(`Saved: ${label}`);
      await reload();
      notifyChanged();
    } catch (e) {
      show((e as Error).message);
      reload();
    }
  }

  async function reset() {
    await api("/api/config", { method: "PUT", body: JSON.stringify({ reset: true, actor: actor || "console" }) });
    show("Reset to PRD defaults");
    await reload();
    notifyChanged();
  }

  const t = draft.thresholds;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Thresholds and switches are configuration, not code (F-6). Every change is written to the audit log.</p>
        </div>
        <button className="btn" onClick={reset}>Reset to defaults</button>
      </div>

      <div className="stack">
        <div className="panel">
          <div className="panel-head"><h2>Confidence gate</h2><span className="faint small">PRD placeholders: 0.80 / 0.55</span></div>
          <div className="setting">
            <div>
              <h3>AUTO threshold — {t.auto.toFixed(2)}</h3>
              <p>At or above: act automatically (if that action is switched on).</p>
            </div>
            <input type="range" min={0.5} max={0.99} step={0.01} value={t.auto}
              onChange={(e) => setDraft({ ...draft, thresholds: { ...t, auto: Number(e.target.value) } })}
              onMouseUp={() => save({ thresholds: draft.thresholds }, "thresholds")}
              onTouchEnd={() => save({ thresholds: draft.thresholds }, "thresholds")}
              onKeyUp={() => save({ thresholds: draft.thresholds }, "thresholds")} />
          </div>
          <div className="setting">
            <div>
              <h3>REVIEW threshold — {t.review.toFixed(2)}</h3>
              <p>Between REVIEW and AUTO: a person approves the suggestion. Below: a person handles it.</p>
            </div>
            <input type="range" min={0.3} max={0.95} step={0.01} value={t.review}
              onChange={(e) => setDraft({ ...draft, thresholds: { ...t, review: Number(e.target.value) } })}
              onMouseUp={() => save({ thresholds: draft.thresholds }, "thresholds")}
              onTouchEnd={() => save({ thresholds: draft.thresholds }, "thresholds")}
              onKeyUp={() => save({ thresholds: draft.thresholds }, "thresholds")} />
          </div>
          <div className="panel-pad" style={{ borderTop: "1px solid var(--border)" }}>
            <ConfidenceMeter value={null} thresholds={t} />
          </div>
          <div className="setting">
            <div>
              <h3>Safety trigger — P(safety) ≥ {draft.safetyTriggerProbability.toFixed(2)}</h3>
              <p>Treat as a safety item even when Jev leans &quot;no&quot;. Lower is more cautious. Our keyword rule runs regardless.</p>
            </div>
            <input type="range" min={0.05} max={0.5} step={0.01} value={draft.safetyTriggerProbability}
              onChange={(e) => setDraft({ ...draft, safetyTriggerProbability: Number(e.target.value) })}
              onMouseUp={() => save({ safetyTriggerProbability: draft.safetyTriggerProbability }, "safety trigger")}
              onTouchEnd={() => save({ safetyTriggerProbability: draft.safetyTriggerProbability }, "safety trigger")}
              onKeyUp={() => save({ safetyTriggerProbability: draft.safetyTriggerProbability }, "safety trigger")} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>Rollout controls</h2></div>
          <div className="setting">
            <div>
              <h3>Shadow mode</h3>
              <p>Decide and log everything, take no actions (F-8, rollout phase 2).</p>
            </div>
            <Switch checked={draft.shadowMode} onChange={(v) => save({ shadowMode: v }, `shadow mode ${v ? "on" : "off"}`)} />
          </div>
          <div className="setting">
            <div>
              <h3>Kill switch — Support desk</h3>
              <p>Route every support item to a person. Jev is not called.</p>
            </div>
            <Switch checked={draft.killSwitch.support} onChange={(v) => save({ killSwitch: { support: v } }, "support kill switch")} />
          </div>
          <div className="setting">
            <div>
              <h3>Kill switch — Agent guard</h3>
              <p>Hold every agent action for a person.</p>
            </div>
            <Switch checked={draft.killSwitch.agentGuard} onChange={(v) => save({ killSwitch: { agentGuard: v } }, "agent guard kill switch")} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>AUTO actions</h2><span className="faint small">off → confident items go to REVIEW instead</span></div>
          <div className="setting">
            <div>
              <h3>Fixed-template replies (S-5)</h3>
              <p>Info requests and lost-ticket questions. Rollout phase 4.</p>
            </div>
            <Switch checked={draft.autoActions.sendTemplate} onChange={(v) => save({ autoActions: { sendTemplate: v } }, "template replies")} />
          </div>
          <div className="setting">
            <div>
              <h3>Pass re-sync + new QR (S-6)</h3>
              <p>Rollout phase 5, needs owning-lead sign-off.</p>
            </div>
            <Switch checked={draft.autoActions.passResync} onChange={(v) => save({ autoActions: { passResync: v } }, "pass re-sync")} />
          </div>
          <div className="setting">
            <div>
              <h3>Remote barrier open (S-4)</h3>
              <p>Rollout phase 5. Open question #4: is this permitted under safety and liability policy?</p>
            </div>
            <Switch checked={draft.autoActions.barrierRemoteOpen} onChange={(v) => save({ autoActions: { barrierRemoteOpen: v } }, "barrier remote open")} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>Agent guard &amp; money</h2></div>
          <div className="setting">
            <div>
              <h3>Refund limit (D-10)</h3>
              <p>Agent refunds above this always need human approval.</p>
            </div>
            <div className="row">
              <span className="muted">₹</span>
              <input className="input" style={{ width: 120 }} inputMode="numeric" value={draft.agentGuard.refundLimitInr}
                onChange={(e) => setDraft({ ...draft, agentGuard: { ...draft.agentGuard, refundLimitInr: Number(e.target.value.replace(/\D/g, "") || 0) } })}
                onBlur={() => save({ agentGuard: { refundLimitInr: draft.agentGuard.refundLimitInr } }, "refund limit")} />
            </div>
          </div>
          <div className="setting">
            <div>
              <h3>Auto-execute agent refunds at or below the limit</h3>
              <p>D-10 allows it at high confidence.</p>
              <div className="callout" style={{ marginTop: 8 }}>
                Conflicts with hard rule #2 and acceptance criterion #2 (&quot;no refund executes without a recorded approval&quot;).
                Off until the PRD owner decides.
              </div>
            </div>
            <Switch checked={draft.agentGuard.autoExecuteSmallRefunds} onChange={(v) => save({ agentGuard: { autoExecuteSmallRefunds: v } }, "auto small refunds")} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>Reliability &amp; privacy</h2></div>
          <div className="setting">
            <div>
              <h3>Jev timeout</h3>
              <p>After this, the item routes to a person (F-7). Vendor claims 70–500 ms per call.</p>
            </div>
            <div className="row">
              <input className="input" style={{ width: 120 }} inputMode="numeric" value={draft.timeoutMs}
                onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value.replace(/\D/g, "") || 0) })}
                onBlur={() => save({ timeoutMs: draft.timeoutMs }, "timeout")} />
              <span className="muted">ms</span>
            </div>
          </div>
          <div className="setting">
            <div>
              <h3>Redact personal data</h3>
              <p>Phones, emails, card numbers, vehicle plates and UPI IDs are masked before calling Jev. Names are not detected yet.</p>
            </div>
            <Switch checked={draft.redactPii} onChange={(v) => save({ redactPii: v }, `redaction ${v ? "on" : "off"}`)} />
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
