"use client";

import { useCallback, useEffect, useState } from "react";
import type { Config } from "@/lib/core/config";
import type { Route } from "@/lib/core/types";

export const pct = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined ? "—" : `${(x * 100).toFixed(digits)}%`;

export function timeAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function RouteBadge({ route, large }: { route: Route; large?: boolean }) {
  return <span className={`route route-${route}${large ? " route-lg" : ""}`}>{route}</span>;
}

export function bandOf(c: number | null, t: Config["thresholds"]): "AUTO" | "REVIEW" | "HUMAN" {
  if (c === null) return "HUMAN";
  return c >= t.auto ? "AUTO" : c >= t.review ? "REVIEW" : "HUMAN";
}

export function ConfidenceMeter({
  value,
  thresholds,
  legend = true,
}: {
  value: number | null;
  thresholds: Config["thresholds"];
  legend?: boolean;
}) {
  const b = bandOf(value, thresholds);
  return (
    <div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={value ?? 0}>
        {value !== null && <div className={`meter-fill band-${b}`} style={{ width: `${Math.max(2, value * 100)}%` }} />}
        <div className="meter-mark" style={{ left: `${thresholds.review * 100}%` }} title={`REVIEW ≥ ${thresholds.review}`} />
        <div className="meter-mark" style={{ left: `${thresholds.auto * 100}%` }} title={`AUTO ≥ ${thresholds.auto}`} />
      </div>
      {legend && (
        <div className="meter-legend" style={{ position: "relative", height: 16 }}>
          <span style={{ position: "absolute", left: 0 }}>HUMAN</span>
          <span style={{ position: "absolute", left: `${thresholds.review * 100}%`, transform: "translateX(-50%)" }}>
            {thresholds.review}
          </span>
          <span style={{ position: "absolute", left: `${thresholds.auto * 100}%`, transform: "translateX(-50%)" }}>
            {thresholds.auto}
          </span>
          <span style={{ position: "absolute", right: 0 }}>AUTO</span>
        </div>
      )}
    </div>
  );
}

export function MiniBar({ value, band }: { value: number; band: "AUTO" | "REVIEW" | "HUMAN" }) {
  return (
    <div className="meter" style={{ height: 6 }}>
      <div className={`meter-fill band-${band}`} style={{ width: `${Math.max(2, value * 100)}%` }} />
    </div>
  );
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface ConfigResponse {
  config: Config;
  defaults: Config;
  provider: string;
  storage?: "memory" | "redis";
}

/** Shared config hook; listens for "pdl:changed" to refresh across components. */
export function useConfig() {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const load = useCallback(() => api<ConfigResponse>("/api/config").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("pdl:changed", h);
    return () => window.removeEventListener("pdl:changed", h);
  }, [load]);
  return { data, reload: load };
}

export function notifyChanged() {
  window.dispatchEvent(new Event("pdl:changed"));
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return { toast: msg ? <div className="toast">{msg}</div> : null, show: setMsg };
}

const ACTOR_KEY = "pdl.actor";
export function useActor(): [string, (v: string) => void] {
  const [actor, setActor] = useState("");
  useEffect(() => {
    try {
      setActor(localStorage.getItem(ACTOR_KEY) ?? "");
    } catch {}
  }, []);
  const set = (v: string) => {
    setActor(v);
    try {
      localStorage.setItem(ACTOR_KEY, v);
    } catch {}
  };
  return [actor, set];
}
