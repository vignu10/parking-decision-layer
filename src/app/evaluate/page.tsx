"use client";

import { useState } from "react";
import { RouteBadge, api, pct, useConfig } from "@/components/ui";
import type { EvalReport } from "@/lib/evaluate";

export default function EvaluatePage() {
  const { data: cfg } = useConfig();
  const [report, setReport] = useState<EvalReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      setReport(await api<EvalReport>("/api/evaluate", { method: "POST" }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const auto = report?.byBand.AUTO;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Offline evaluation</h1>
          <p>
            Rollout phase 1: run labelled historical cases through the layer (no actions) and check agreement with staff by
            confidence band, before anything is automated.
          </p>
        </div>
        <div className="row">
          {cfg && (
            <span className="pill">
              using AUTO ≥ {cfg.config.thresholds.auto} · REVIEW ≥ {cfg.config.thresholds.review}
            </span>
          )}
          <button className="btn btn-primary" onClick={run} disabled={busy}>
            {busy ? "Running…" : report ? "Re-run" : "Run evaluation"}
          </button>
        </div>
      </div>
      {err && <p style={{ color: "var(--blocked)" }}>{err}</p>}

      {!report ? (
        <div className="panel empty">Runs the labelled sample set with the current settings. Change thresholds in Settings and re-run to tune.</div>
      ) : (
        <div className="stack">
          <div className="metrics" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 0 }}>
            <div className="panel metric">
              <div className="k">AUTO-band agreement</div>
              <div className="v" style={{ color: report.autoBandMeetsTarget ? "var(--auto)" : "var(--blocked)" }}>
                {auto ? pct(auto.rate) : "—"}
              </div>
              <div className="s">target ≥ {pct(report.target)} before real actions</div>
            </div>
            <div className="panel metric">
              <div className="k">Overall agreement</div>
              <div className="v">{pct(report.overall.rate)}</div>
              <div className="s">{report.overall.agree} of {report.overall.total} cases</div>
            </div>
            <div className="panel metric">
              <div className="k">Safety / money misses</div>
              <div className="v" style={{ color: report.safetyOrMoneyDisagreements ? "var(--blocked)" : "var(--auto)" }}>
                {report.safetyOrMoneyDisagreements}
              </div>
              <div className="s">must be 0</div>
            </div>
            <div className="panel metric">
              <div className="k">By band</div>
              <div className="small" style={{ marginTop: 6 }}>
                {(["AUTO", "REVIEW", "HUMAN", "n/a"] as const).map((b) =>
                  report.byBand[b] ? (
                    <div key={b} className="row" style={{ justifyContent: "space-between" }}>
                      <span className="muted">{b}</span>
                      <span className="mono">
                        {report.byBand[b].agree}/{report.byBand[b].total} · {pct(report.byBand[b].rate)}
                      </span>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Item</th>
                    <th>Staff</th>
                    <th>Layer</th>
                    <th className="num">Conf</th>
                    <th>Band</th>
                    <th>Category (staff → Jev)</th>
                    <th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.id} style={r.agree ? undefined : { background: "var(--blocked-bg)" }}>
                      <td className="mono">{r.id}</td>
                      <td className="small" style={{ maxWidth: 380 }}>{r.title}</td>
                      <td><RouteBadge route={r.expected} /></td>
                      <td><RouteBadge route={r.actual} /></td>
                      <td className="num">{pct(r.confidence)}</td>
                      <td className="small muted">{r.band}</td>
                      <td className="small">
                        {r.categoryExpected ? (
                          <>
                            {r.categoryExpected}
                            {r.categoryActual !== r.categoryExpected && <span style={{ color: "var(--blocked)" }}> → {r.categoryActual}</span>}
                          </>
                        ) : (
                          <span className="faint">{r.categoryActual}</span>
                        )}
                      </td>
                      <td className="small">
                        {r.rule ?? ""}
                        {r.error && <div className="mono" style={{ color: "var(--blocked)", marginTop: 4, overflowWrap: "anywhere" }}>{r.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="small faint">
            Staff labels are synthetic and assume default settings. With the mock, numbers show how the method works; run with
            JEV_PROVIDER=vercel on 50–100 anonymised real cases per workflow for numbers you can act on.
          </p>
        </div>
      )}
    </>
  );
}
