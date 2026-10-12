"use client";

import { useEffect, useMemo, useState } from "react";
import { RouteBadge, api, pct } from "@/components/ui";
import type { AuditEvent, AuditType } from "@/lib/core/types";

const TYPES: (AuditType | "all")[] = ["all", "decision", "action", "approval", "rejection", "handled", "error", "config_change"];

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [type, setType] = useState<(typeof TYPES)[number]>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    const load = () => api<{ events: AuditEvent[] }>("/api/audit").then((d) => setEvents(d.events)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter(
      (e) => (type === "all" || e.type === type) && (!needle || JSON.stringify(e).toLowerCase().includes(needle)),
    );
  }, [events, type, q]);

  function download() {
    const blob = new Blob([[...events].reverse().map((e) => JSON.stringify(e)).join("\n") + "\n"], { type: "application/x-ndjson" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Append-only record of every decision and action: what, with what confidence, by which rule, by whom.</p>
        </div>
        <div className="row">
          <select className="select" style={{ width: 160 }} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t === "all" ? "All events" : t}</option>
            ))}
          </select>
          <input className="input" style={{ width: 200 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={download} disabled={!events.length}>Export JSONL</button>
        </div>
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <div className="empty">No events yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Route</th>
                  <th className="num">Conf</th>
                  <th>Rule</th>
                  <th>Reason / result</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.seq}>
                    <td className="num faint">{e.seq}</td>
                    <td className="mono faint" style={{ whiteSpace: "nowrap" }}>{new Date(e.ts).toLocaleTimeString()}</td>
                    <td>
                      <span className={`pill ${e.type === "error" || e.type === "rejection" ? "pill-danger" : e.type === "approval" ? "pill-ok" : ""}`}>{e.type}</span>
                      {e.shadow && <span className="pill pill-warn" style={{ marginLeft: 4 }}>shadow</span>}
                    </td>
                    <td>{e.route ? <RouteBadge route={e.route} /> : <span className="faint">—</span>}</td>
                    <td className="num">{e.confidence === undefined ? "" : pct(e.confidence)}</td>
                    <td className="small">{e.rule ?? ""}</td>
                    <td className="small" style={{ maxWidth: 480 }}>{e.reason}</td>
                    <td className="small muted">{e.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
