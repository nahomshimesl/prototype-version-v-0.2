import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Database,
  RefreshCw,
  AlertTriangle,
  Inbox,
  X,
  Activity,
  ShieldAlert,
  Clock,
} from 'lucide-react';
import { auth } from '../firebase';

export interface SimulationRunRow {
  id: string | number;
  started_at: string;
  ended_at: string | null;
  final_step: number | null;
  final_health: number | null;
  agent_count: number | null;
  notes: any;
}

interface DbStatus {
  configured: boolean;
  connected: boolean;
  migrated: boolean;
  serverVersion?: string;
  databaseSizePretty?: string;
  error?: string;
}

type LoadState = 'IDLE' | 'LOADING' | 'OK' | 'ERROR';

async function getAuthHeader(): Promise<Record<string, string>> {
  const u = auth.currentUser;
  if (!u) return {};
  try {
    const token = await u.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatHealth(h: number | null): string {
  if (h === null || h === undefined || Number.isNaN(h)) return '—';
  return `${h.toFixed(1)}%`;
}

function healthColor(h: number | null): string {
  if (h === null || h === undefined || Number.isNaN(h)) return 'text-slate-500';
  if (h >= 70) return 'text-emerald-600';
  if (h >= 30) return 'text-amber-600';
  return 'text-rose-600';
}

interface RunHistoryPanelProps {
  isOperator: boolean;
  refreshKey?: number;
}

export default function RunHistoryPanel({ isOperator, refreshKey = 0 }: RunHistoryPanelProps) {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [runs, setRuns] = useState<SimulationRunRow[]>([]);
  const [load, setLoad] = useState<LoadState>('IDLE');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/db/status');
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        setStatusError(body?.error || `Status check failed (${res.status})`);
        setStatus(null);
        return;
      }
      setStatusError(null);
      setStatus(body as DbStatus);
    } catch (e: any) {
      setStatusError(e?.message || 'Could not reach the server.');
      setStatus(null);
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    if (!isOperator) {
      setRuns([]);
      setLoad('IDLE');
      setLoadError(null);
      return;
    }
    setLoad('LOADING');
    setLoadError(null);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/db/runs?limit=100', { headers });
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        setLoadError(body?.error || `Request failed (${res.status})`);
        setRuns([]);
        setLoad('ERROR');
        return;
      }
      const list = Array.isArray(body?.runs) ? (body.runs as SimulationRunRow[]) : [];
      setRuns(list);
      setLoad('OK');
    } catch (e: any) {
      setLoadError(e?.message || 'Network error while fetching runs.');
      setRuns([]);
      setLoad('ERROR');
    }
  }, [isOperator]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus, refreshKey]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns, refreshKey]);

  const selected = useMemo(
    () => runs.find((r) => String(r.id) === String(selectedId)) ?? null,
    [runs, selectedId],
  );

  const dbReady = status?.configured && status?.connected;
  const dbNotConfigured = status && !status.configured;
  const dbConnectError = status && status.configured && !status.connected;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold text-emerald-50 flex items-center gap-3">
              <Database className="text-indigo-400" size={24} />
              Run History
            </h2>
            <p className="text-emerald-400 text-sm">
              Saved simulation snapshots persisted to the operator database.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {status && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-900/40 border border-emerald-800 rounded-xl">
                <div
                  className={`w-2 h-2 rounded-full ${
                    dbReady ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                  {dbReady
                    ? 'DB Connected'
                    : dbNotConfigured
                      ? 'DB Not Configured'
                      : 'DB Error'}
                </span>
                {status.databaseSizePretty && dbReady && (
                  <span className="text-[10px] font-mono text-emerald-500 ml-1">
                    {status.databaseSizePretty}
                  </span>
                )}
              </div>
            )}
            <button
              onClick={() => {
                fetchStatus();
                fetchRuns();
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition-all"
              title="Refresh"
            >
              <RefreshCw size={14} className={load === 'LOADING' ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Status / error banners */}
        {statusError && (
          <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-start gap-3 text-rose-300">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold uppercase tracking-widest mb-1">
                Could not check database status
              </div>
              <div className="text-rose-200/80">{statusError}</div>
            </div>
          </div>
        )}

        {dbNotConfigured && (
          <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3 text-amber-300">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold uppercase tracking-widest mb-1">
                Database not configured
              </div>
              <div className="text-amber-200/80">
                Set <code className="font-mono">DATABASE_URL</code> on the server to enable run
                persistence. Until then, saved snapshots cannot be stored or browsed.
              </div>
            </div>
          </div>
        )}

        {dbConnectError && (
          <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-start gap-3 text-rose-300">
            <ShieldAlert size={18} className="shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold uppercase tracking-widest mb-1">
                Database connection error
              </div>
              <div className="text-rose-200/80">
                {status?.error || 'The server could not connect to the configured database.'}
              </div>
            </div>
          </div>
        )}

        {!isOperator && dbReady && (
          <div className="mb-4 p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl flex items-start gap-3 text-indigo-200">
            <ShieldAlert size={18} className="shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold uppercase tracking-widest mb-1">
                Operator sign-in required
              </div>
              <div className="text-indigo-100/80">
                Sign in with an operator account to browse saved simulation runs.
              </div>
            </div>
          </div>
        )}

        {loadError && isOperator && dbReady && (
          <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-start gap-3 text-rose-300">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold uppercase tracking-widest mb-1">
                Could not load runs
              </div>
              <div className="text-rose-200/80">{loadError}</div>
            </div>
          </div>
        )}

        {/* Main grid: list + detail panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`${selected ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden`}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Clock className="text-indigo-500" size={18} />
                Saved Runs
                {load === 'OK' && (
                  <span className="text-[10px] font-mono text-slate-400 ml-2">
                    {runs.length}
                  </span>
                )}
              </h3>
            </div>

            {load === 'LOADING' ? (
              <div className="p-12 flex flex-col items-center justify-center text-slate-400">
                <Activity className="animate-spin mb-2" size={24} />
                <span className="text-xs font-bold uppercase tracking-widest">
                  Loading runs…
                </span>
              </div>
            ) : !isOperator ? (
              <div className="p-12 flex flex-col items-center justify-center text-slate-400 text-center">
                <Database size={32} className="mb-2 opacity-40" />
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Sign in required
                </p>
                <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
                  Operator sign-in is needed to view saved runs.
                </p>
              </div>
            ) : !dbReady ? (
              <div className="p-12 flex flex-col items-center justify-center text-slate-400 text-center">
                <Database size={32} className="mb-2 opacity-40" />
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Database unavailable
                </p>
              </div>
            ) : load === 'OK' && runs.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-slate-400 text-center">
                <Inbox size={32} className="mb-2 opacity-40" />
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  No saved runs yet
                </p>
                <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
                  Use “Save current run” on the Simulation tab to persist the current snapshot.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="text-left px-6 py-3">Saved</th>
                      <th className="text-right px-4 py-3">Final Step</th>
                      <th className="text-right px-4 py-3">Final Health</th>
                      <th className="text-right px-6 py-3">Agents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => {
                      const isSelected = String(r.id) === String(selectedId);
                      return (
                        <tr
                          key={String(r.id)}
                          onClick={() =>
                            setSelectedId(isSelected ? null : r.id)
                          }
                          className={`border-t border-slate-100 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-indigo-50'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-6 py-3 text-slate-700">
                            <div className="font-medium">
                              {formatDate(r.ended_at || r.started_at)}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">
                              ID {String(r.id)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-slate-700">
                            {r.final_step ?? '—'}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono font-bold ${healthColor(r.final_health)}`}>
                            {formatHealth(r.final_health)}
                          </td>
                          <td className="px-6 py-3 text-right font-mono text-slate-700">
                            {r.agent_count ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Side panel for selected run */}
          <AnimatePresence>
            {selected && (
              <motion.aside
                key={String(selected.id)}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4 lg:col-span-1 self-start sticky top-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Run Detail
                    </div>
                    <div className="text-lg font-bold text-slate-900 font-mono">
                      #{String(selected.id)}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedId(null)}
                    className="p-1 text-slate-400 hover:text-slate-700 transition-colors"
                    title="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <dt className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Started
                    </dt>
                    <dd className="font-mono text-slate-800">
                      {formatDate(selected.started_at)}
                    </dd>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <dt className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Ended
                    </dt>
                    <dd className="font-mono text-slate-800">
                      {selected.ended_at ? formatDate(selected.ended_at) : '—'}
                    </dd>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <dt className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Final Step
                    </dt>
                    <dd className="font-mono text-slate-800">
                      {selected.final_step ?? '—'}
                    </dd>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <dt className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Agents
                    </dt>
                    <dd className="font-mono text-slate-800">
                      {selected.agent_count ?? '—'}
                    </dd>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 col-span-2">
                    <dt className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                      Final Health
                    </dt>
                    <dd className={`font-mono font-bold ${healthColor(selected.final_health)}`}>
                      {formatHealth(selected.final_health)}
                    </dd>
                  </div>
                </dl>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Notes / Metadata
                  </div>
                  {selected.notes ? (
                    <pre className="text-[11px] font-mono bg-slate-900 text-emerald-200 rounded-xl p-3 overflow-x-auto max-h-72 whitespace-pre-wrap break-words">
                      {(() => {
                        try {
                          if (typeof selected.notes === 'string') {
                            try {
                              return JSON.stringify(JSON.parse(selected.notes), null, 2);
                            } catch {
                              return selected.notes;
                            }
                          }
                          return JSON.stringify(selected.notes, null, 2);
                        } catch {
                          return String(selected.notes);
                        }
                      })()}
                    </pre>
                  ) : (
                    <div className="text-xs text-slate-400 italic">
                      No notes recorded for this run.
                    </div>
                  )}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
