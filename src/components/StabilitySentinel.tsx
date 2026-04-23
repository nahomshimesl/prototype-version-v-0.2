/**
 * Stability Sentinel — developer dashboard.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { ShieldAlert, Activity, Brain, Wrench, RefreshCw, CheckCircle2, AlertTriangle, Cpu, Clock, ChevronRight, Zap } from "lucide-react";
import { SentinelClient } from "../services/SentinelClient";

interface Incident {
  id: string;
  fingerprint: string;
  source: string;
  kind: string;
  message: string;
  stack?: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "ANALYZING" | "ACKNOWLEDGED" | "RESOLVED";
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  contexts: any[];
  analysis?: {
    summary: string;
    category: string;
    fixes: { title: string; detail: string; confidence: number; safety: "SAFE" | "REVIEW" | "RISKY"; recoveryAction?: string }[];
    generatedAt: number;
  };
  recoveryHistory: { action: string; at: number; ok: boolean; note?: string }[];
}

interface Anomaly {
  id: string;
  type: string;
  severity: string;
  message: string;
  detectedAt: number;
  metrics: Record<string, number>;
}

interface Stats {
  incidents: number;
  openIncidents: number;
  errorsLastMinute: number;
  anomalies: number;
  memory: { rssMB: number; heapUsedMB: number };
  uptimeSec: number;
}

const sevColor = (s: string) =>
  s === "CRITICAL" ? "text-rose-400 bg-rose-500/10 border-rose-500/30" :
  s === "HIGH" ? "text-orange-400 bg-orange-500/10 border-orange-500/30" :
  s === "MEDIUM" ? "text-amber-400 bg-amber-500/10 border-amber-500/30" :
                   "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";

const safetyColor = (s: string) =>
  s === "SAFE" ? "text-emerald-300 bg-emerald-500/10" :
  s === "REVIEW" ? "text-amber-300 bg-amber-500/10" :
                   "text-rose-300 bg-rose-500/10";

const fmtTime = (t: number) => {
  const d = Math.floor((Date.now() - t) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(t).toLocaleString();
};

export default function StabilitySentinel() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [actions, setActions] = useState<{ id: string; label: string; safety: string; description: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("OPEN");

  const refresh = useCallback(async () => {
    try {
      const [i, a, s, ax] = await Promise.all([
        SentinelClient.fetchIncidents(),
        SentinelClient.fetchAnomalies(),
        SentinelClient.fetchStats(),
        SentinelClient.fetchActions(),
      ]);
      setIncidents(i); setAnomalies(a); setStats(s); setActions(ax);
    } catch { /* network blip — UI stays */ }
  }, []);

  useEffect(() => {
    refresh();
    const off = SentinelClient.onEvent((event) => {
      if (event.startsWith("sentinel:")) refresh();
    });
    const t = setInterval(refresh, 5000);
    return () => { off(); clearInterval(t); };
  }, [refresh]);

  const selected = useMemo(() => incidents.find((i) => i.id === selectedId) ?? null, [incidents, selectedId]);

  const visible = useMemo(() => {
    if (filter === "ALL") return incidents;
    if (filter === "RESOLVED") return incidents.filter((i) => i.status === "RESOLVED");
    return incidents.filter((i) => i.status === "OPEN" || i.status === "ANALYZING" || i.status === "ACKNOWLEDGED");
  }, [incidents, filter]);

  const analyze = async (id: string, force = false) => {
    setAnalyzing(id);
    try { await SentinelClient.analyze(id, force); await refresh(); }
    catch (e) { console.warn("Analyze failed", e); }
    finally { setAnalyzing(null); }
  };

  const recover = async (id: string, action: string) => {
    setRunning(`${id}:${action}`);
    try { await SentinelClient.recover(id, action); await refresh(); }
    finally { setRunning(null); }
  };

  return (
    <div className="space-y-4 text-emerald-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <ShieldAlert className="text-emerald-300" size={20} />
          </div>
          <div>
            <div className="text-lg font-bold">Stability Sentinel</div>
            <div className="text-xs text-emerald-400">Self-diagnosing reliability subsystem</div>
          </div>
        </div>
        <button
          onClick={refresh}
          className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-900/40 border border-emerald-800 hover:bg-emerald-800/40"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat icon={<AlertTriangle size={14} />} label="Open incidents" value={stats?.openIncidents ?? 0} tone={stats && stats.openIncidents > 0 ? "warn" : "ok"} />
        <Stat icon={<Activity size={14} />} label="Errors / min" value={stats?.errorsLastMinute ?? 0} tone={stats && stats.errorsLastMinute >= 10 ? "warn" : "ok"} />
        <Stat icon={<Zap size={14} />} label="Anomalies" value={stats?.anomalies ?? 0} tone={stats && stats.anomalies > 0 ? "warn" : "ok"} />
        <Stat icon={<Cpu size={14} />} label="RSS memory" value={`${stats?.memory.rssMB ?? 0} MB`} />
        <Stat icon={<Clock size={14} />} label="Uptime" value={`${Math.floor((stats?.uptimeSec ?? 0) / 60)}m`} />
      </div>

      {/* Live anomalies */}
      {anomalies.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300 mb-2">Active anomalies</div>
          <div className="space-y-1.5">
            {anomalies.slice(0, 4).map((a) => (
              <div key={a.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${sevColor(a.severity)}`}>{a.type}</span>
                  <span className="text-emerald-200">{a.message}</span>
                </div>
                <span className="text-emerald-500 text-[10px]">{fmtTime(a.detectedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1.5">
        {(["OPEN", "RESOLVED", "ALL"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[11px] px-3 py-1.5 rounded-lg border ${filter === f ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200" : "bg-emerald-900/30 border-emerald-800 text-emerald-400 hover:bg-emerald-800/30"}`}
          >
            {f} ({f === "ALL" ? incidents.length : f === "RESOLVED" ? incidents.filter(i => i.status === "RESOLVED").length : incidents.filter(i => i.status !== "RESOLVED").length})
          </button>
        ))}
      </div>

      {/* Two-pane: list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Incident list */}
        <div className="lg:col-span-2 space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {visible.length === 0 ? (
            <div className="text-center py-10 text-emerald-500 text-sm border border-dashed border-emerald-800 rounded-2xl">
              <CheckCircle2 className="mx-auto mb-2 text-emerald-400" size={28} />
              No incidents in this view.
            </div>
          ) : visible.map((inc) => (
            <button
              key={inc.id}
              onClick={() => setSelectedId(inc.id)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${selectedId === inc.id ? "border-emerald-500/50 bg-emerald-500/10" : "border-emerald-800 bg-emerald-900/30 hover:bg-emerald-900/50"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${sevColor(inc.severity)}`}>{inc.severity}</span>
                    <span className="text-[10px] text-emerald-500 font-mono uppercase">{inc.kind}</span>
                    {inc.status !== "OPEN" && <span className="text-[9px] text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10">{inc.status}</span>}
                  </div>
                  <div className="text-xs text-emerald-100 truncate">{inc.message}</div>
                  <div className="text-[10px] text-emerald-500 mt-1 flex items-center gap-2">
                    <span>{inc.source}</span>
                    <span>·</span>
                    <span>{inc.occurrences}× </span>
                    <span>·</span>
                    <span>{fmtTime(inc.lastSeen)}</span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-emerald-600 mt-1" />
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3 rounded-2xl border border-emerald-800 bg-emerald-950/60 p-4 min-h-[40vh]">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-emerald-600 text-sm">Select an incident to inspect</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${sevColor(selected.severity)}`}>{selected.severity}</span>
                  <span className="text-xs text-emerald-400 font-mono">{selected.kind}</span>
                  <span className="text-[10px] text-emerald-600 font-mono">#{selected.fingerprint}</span>
                </div>
                <div className="text-sm font-semibold text-emerald-100 break-all">{selected.message}</div>
                <div className="text-[11px] text-emerald-500 mt-1">
                  {selected.source} · seen {selected.occurrences}× · first {fmtTime(selected.firstSeen)} · last {fmtTime(selected.lastSeen)}
                </div>
              </div>

              {/* AI analysis */}
              <div className="rounded-xl border border-emerald-800 bg-emerald-900/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                    <Brain size={12} /> Root cause analysis
                  </div>
                  <button
                    onClick={() => analyze(selected.id, !!selected.analysis)}
                    disabled={analyzing === selected.id}
                    className="text-[10px] px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {analyzing === selected.id ? "Analyzing…" : selected.analysis ? "Re-analyze" : "Analyze"}
                  </button>
                </div>
                {selected.analysis ? (
                  <>
                    <div className="text-xs text-emerald-100 leading-relaxed">{selected.analysis.summary}</div>
                    <div className="text-[10px] text-emerald-500 mt-1">Category: {selected.analysis.category}</div>
                    <div className="mt-3 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
                        <Wrench size={11} /> Suggested fixes (ranked)
                      </div>
                      {selected.analysis.fixes.map((f, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-emerald-950/50 border border-emerald-800">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-xs font-semibold text-emerald-100">{f.title}</div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] text-emerald-400">{Math.round(f.confidence * 100)}%</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded ${safetyColor(f.safety)}`}>{f.safety}</span>
                            </div>
                          </div>
                          <div className="text-[11px] text-emerald-300 leading-relaxed">{f.detail}</div>
                          {f.recoveryAction && (
                            <button
                              onClick={() => recover(selected.id, f.recoveryAction!)}
                              disabled={running === `${selected.id}:${f.recoveryAction}` || f.safety === "RISKY"}
                              className="mt-2 text-[10px] px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
                            >
                              {running === `${selected.id}:${f.recoveryAction}` ? "Running…" : `Apply: ${f.recoveryAction}`}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-emerald-500">No analysis yet. Click Analyze to run AI diagnosis.</div>
                )}
              </div>

              {/* Manual recovery actions */}
              <div className="rounded-xl border border-emerald-800 bg-emerald-900/30 p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-2 flex items-center gap-1.5">
                  <Wrench size={12} /> Manual recovery actions
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {actions.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => recover(selected.id, a.id)}
                      disabled={running === `${selected.id}:${a.id}` || a.safety === "RISKY"}
                      title={a.description}
                      className="text-[10px] text-left px-2 py-1.5 rounded border border-emerald-800 bg-emerald-950/50 hover:bg-emerald-900/60 disabled:opacity-40"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-100">{a.label}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded ${safetyColor(a.safety)}`}>{a.safety}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Stack & context */}
              {selected.stack && (
                <details className="rounded-xl border border-emerald-800 bg-emerald-900/30 p-3">
                  <summary className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 cursor-pointer">Stack trace</summary>
                  <pre className="mt-2 text-[10px] text-emerald-300 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{selected.stack}</pre>
                </details>
              )}

              {selected.contexts.length > 0 && (
                <details className="rounded-xl border border-emerald-800 bg-emerald-900/30 p-3">
                  <summary className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 cursor-pointer">Context snapshot</summary>
                  <pre className="mt-2 text-[10px] text-emerald-300 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">{JSON.stringify(selected.contexts[0], null, 2)}</pre>
                </details>
              )}

              {selected.recoveryHistory.length > 0 && (
                <div className="rounded-xl border border-emerald-800 bg-emerald-900/30 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-2">Recovery history</div>
                  <div className="space-y-1">
                    {selected.recoveryHistory.slice().reverse().map((h, i) => (
                      <div key={i} className="text-[11px] flex items-center justify-between">
                        <span className="text-emerald-200">{h.action}</span>
                        <span className={h.ok ? "text-emerald-400" : "text-rose-400"}>
                          {h.ok ? "✓" : "✗"} {h.note ?? ""} <span className="text-emerald-600">{fmtTime(h.at)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, tone = "ok" }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "ok" | "warn" }) {
  return (
    <div className={`rounded-xl border p-2.5 ${tone === "warn" ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-800 bg-emerald-900/30"}`}>
      <div className="text-[10px] uppercase tracking-widest text-emerald-500 flex items-center gap-1">{icon} {label}</div>
      <div className="text-lg font-bold text-emerald-100 mt-0.5">{value}</div>
    </div>
  );
}
