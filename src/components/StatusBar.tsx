"use client";

import { useConfig } from "./ui";

export function StatusBar() {
  const { data } = useConfig();
  if (!data) return null;
  const { config, provider } = data;
  return (
    <div className="statusbar">
      <span className={`pill ${provider === "mock" ? "" : "pill-ok"}`} title="JEV_PROVIDER">
        <span className="dot" /> Jev: {provider === "mock" ? "mock (offline)" : provider}
      </span>
      <span className={`pill ${data.storage === "redis" ? "pill-ok" : ""}`} title="Where decisions and the audit log are stored">
        Storage: {data.storage ?? "memory"}
      </span>
      {config.shadowMode && (
        <span className="pill pill-warn">
          <span className="dot" /> Shadow mode — no actions
        </span>
      )}
      {config.killSwitch.support && <span className="pill pill-danger">Kill switch: support</span>}
      {config.killSwitch.agentGuard && <span className="pill pill-danger">Kill switch: agent guard</span>}
      <span className="pill" title="Confidence thresholds">
        AUTO ≥ {config.thresholds.auto} · REVIEW ≥ {config.thresholds.review}
      </span>
    </div>
  );
}
