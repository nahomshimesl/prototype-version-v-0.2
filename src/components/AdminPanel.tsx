import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert,
  UserPlus,
  Trash2,
  Lock,
  Mail,
  RefreshCw,
  Activity,
  AlertTriangle,
  Inbox,
  History,
  Users,
} from 'lucide-react';
import { auth } from '../firebase';

interface AllowEntry {
  email: string;
  addedBy: string;
  addedAt: string;
  note?: string;
}

interface AuditEntry {
  ts: string;
  action: 'ADD' | 'REMOVE';
  targetEmail: string;
  actorEmail?: string;
  actorUid: string;
}

interface OperatorsResponse {
  ok: boolean;
  envOperatorEmails: string[];
  envOperatorUids: string[];
  ownerEmails: string[];
  dynamic: AllowEntry[];
  error?: string;
}

interface AdminPanelProps {
  isOwner: boolean;
}

async function authHeader(): Promise<Record<string, string>> {
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
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminPanel({ isOwner }: AdminPanelProps) {
  const [data, setData] = useState<OperatorsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [emailInput, setEmailInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [addState, setAddState] = useState<'IDLE' | 'SAVING' | 'OK' | 'ERROR'>('IDLE');
  const [addError, setAddError] = useState<string | null>(null);

  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!isOwner) {
      setData(null);
      setAudit([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setAuditError(null);
    const headers = await authHeader();
    try {
      const [opRes, auRes] = await Promise.all([
        fetch('/api/admin/operators', { headers }),
        fetch('/api/admin/audit?limit=100', { headers }),
      ]);
      const opBody = (await opRes.json().catch(() => ({}))) as OperatorsResponse;
      if (!opRes.ok || !opBody.ok) {
        setLoadError(opBody?.error || `Could not load operators (${opRes.status})`);
        setData(null);
      } else {
        setData(opBody);
      }
      const auBody = (await auRes.json().catch(() => ({}))) as {
        ok?: boolean;
        audit?: AuditEntry[];
        error?: string;
      };
      if (!auRes.ok || !auBody.ok) {
        setAuditError(auBody?.error || `Could not load audit log (${auRes.status})`);
        setAudit([]);
      } else {
        setAudit(auBody.audit ?? []);
      }
    } catch (e: any) {
      setLoadError(e?.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const existingEmails = useMemo(() => {
    if (!data) return new Set<string>();
    return new Set<string>([
      ...data.envOperatorEmails,
      ...data.ownerEmails,
      ...data.dynamic.map((d) => d.email),
    ]);
  }, [data]);

  const handleAdd = async () => {
    setAddError(null);
    const email = emailInput.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddState('ERROR');
      setAddError('Enter a valid email address.');
      return;
    }
    if (existingEmails.has(email)) {
      setAddState('ERROR');
      setAddError('This email is already on the operator allow-list.');
      return;
    }
    setAddState('SAVING');
    try {
      const headers = await authHeader();
      const res = await fetch('/api/admin/operators', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, note: noteInput.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setAddState('ERROR');
        setAddError(body?.error || `Add failed (${res.status})`);
        return;
      }
      setAddState('OK');
      setEmailInput('');
      setNoteInput('');
      await fetchAll();
      setTimeout(() => setAddState('IDLE'), 1500);
    } catch (e: any) {
      setAddState('ERROR');
      setAddError(e?.message || 'Network error.');
    }
  };

  const handleRemove = async (email: string) => {
    setRemoveError(null);
    if (!confirm(`Remove operator ${email}? They will lose access on next request (cache TTL up to 30s on other servers).`)) {
      return;
    }
    setRemovingEmail(email);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/admin/operators/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setRemoveError(body?.error || `Remove failed (${res.status})`);
        return;
      }
      await fetchAll();
    } catch (e: any) {
      setRemoveError(e?.message || 'Network error.');
    } finally {
      setRemovingEmail(null);
    }
  };

  if (!isOwner) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-8">
        <div className="max-w-2xl mx-auto mt-12 p-8 bg-emerald-900/40 border border-emerald-800 rounded-3xl text-center">
          <Lock className="mx-auto text-emerald-400 mb-4" size={32} />
          <h2 className="text-xl font-bold text-emerald-50 mb-2">Owner access required</h2>
          <p className="text-sm text-emerald-300 max-w-md mx-auto">
            The Admin tab is only visible to users whose email is on the
            <code className="font-mono mx-1 px-1.5 py-0.5 bg-emerald-950 rounded">OWNER_EMAILS</code>
            server allow-list. If you should have access, ask the deployer to add your email and redeploy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold text-emerald-50 flex items-center gap-3">
              <Users className="text-amber-300" size={24} />
              Admin · Operator Access
            </h2>
            <p className="text-emerald-400 text-sm">
              Manage the dynamic operator allow-list. Owners and env-defined operators are read-only here.
            </p>
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {loadError && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-start gap-3 text-rose-300">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold uppercase tracking-widest mb-1">
                Could not load operators
              </div>
              <div className="text-rose-200/80">{loadError}</div>
            </div>
          </div>
        )}

        {/* Add operator form */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="text-emerald-500" size={20} />
            <h3 className="font-bold text-slate-900">Add operator</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="email"
                placeholder="[email protected]"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  if (addState === 'ERROR') setAddState('IDLE');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 transition-all"
              />
            </div>
            <input
              type="text"
              placeholder="Note (optional, e.g. who/why)"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
              maxLength={200}
              className="bg-slate-50 border border-slate-200 rounded-xl py-2 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 transition-all"
            />
            <button
              onClick={handleAdd}
              disabled={addState === 'SAVING' || !emailInput.trim()}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm transition-all ${
                addState === 'SAVING' || !emailInput.trim()
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-500 text-white hover:bg-emerald-600'
              }`}
            >
              <UserPlus size={16} />
              {addState === 'SAVING' ? 'Adding…' : 'Add'}
            </button>
          </div>
          {addError && addState === 'ERROR' && (
            <div className="mt-3 text-xs text-rose-600 flex items-center gap-2">
              <AlertTriangle size={12} />
              {addError}
            </div>
          )}
          {addState === 'OK' && (
            <div className="mt-3 text-xs text-emerald-600 font-bold">
              Operator added. They can sign in immediately.
            </div>
          )}
        </div>

        {removeError && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-start gap-3 text-rose-300">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="text-xs text-rose-200/80">{removeError}</div>
          </div>
        )}

        {/* Dynamic list */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <Users className="text-indigo-500" size={18} />
              Dynamic operators
              {data && (
                <span className="text-[10px] font-mono text-slate-400 ml-2">
                  {data.dynamic.length}
                </span>
              )}
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Managed via this panel
            </span>
          </div>
          {loading && !data ? (
            <div className="p-12 flex flex-col items-center justify-center text-slate-400">
              <Activity className="animate-spin mb-2" size={24} />
              <span className="text-xs font-bold uppercase tracking-widest">Loading…</span>
            </div>
          ) : data && data.dynamic.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-slate-400 text-center">
              <Inbox size={32} className="mb-2 opacity-40" />
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                No dynamic operators yet
              </p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
                Add an email above to grant operator access without redeploying.
              </p>
            </div>
          ) : data ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="text-left px-6 py-3">Email</th>
                    <th className="text-left px-4 py-3">Added</th>
                    <th className="text-left px-4 py-3">Added by</th>
                    <th className="text-left px-4 py-3">Note</th>
                    <th className="text-right px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {data.dynamic.map((entry) => (
                      <motion.tr
                        key={entry.email}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="border-t border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-6 py-3 font-mono text-slate-900">{entry.email}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">
                          {formatDate(entry.addedAt)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{entry.addedBy}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">
                          {entry.note ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button
                            onClick={() => handleRemove(entry.email)}
                            disabled={removingEmail === entry.email}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-600 rounded-lg text-xs font-bold transition-all"
                          >
                            <Trash2 size={12} />
                            {removingEmail === entry.email ? 'Removing…' : 'Remove'}
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Read-only env lists */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-emerald-900/40 rounded-3xl border border-emerald-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-amber-300 flex items-center gap-2">
                  <Lock size={16} />
                  Owners
                </h3>
                <span className="text-[10px] font-mono text-emerald-400">
                  {data.ownerEmails.length}
                </span>
              </div>
              <p className="text-[11px] text-emerald-400 mb-3">
                From <code className="font-mono">OWNER_EMAILS</code>. Always operators; can manage this allow-list. Edit the env var to change.
              </p>
              <ul className="space-y-1">
                {data.ownerEmails.length === 0 ? (
                  <li className="text-xs italic text-emerald-500">None configured.</li>
                ) : (
                  data.ownerEmails.map((e) => (
                    <li key={e} className="text-xs font-mono text-emerald-100 bg-emerald-950/60 rounded-lg px-2 py-1">
                      {e}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div className="bg-emerald-900/40 rounded-3xl border border-emerald-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-emerald-300 flex items-center gap-2">
                  <Lock size={16} />
                  Env-managed operators
                </h3>
                <span className="text-[10px] font-mono text-emerald-400">
                  {data.envOperatorEmails.length + data.envOperatorUids.length}
                </span>
              </div>
              <p className="text-[11px] text-emerald-400 mb-3">
                From <code className="font-mono">OPERATOR_EMAILS</code> / <code className="font-mono">OPERATOR_UIDS</code>. Read-only here — edit env vars to change.
              </p>
              <ul className="space-y-1">
                {data.envOperatorEmails.length + data.envOperatorUids.length === 0 ? (
                  <li className="text-xs italic text-emerald-500">None configured.</li>
                ) : (
                  <>
                    {data.envOperatorEmails.map((e) => (
                      <li key={`e-${e}`} className="text-xs font-mono text-emerald-100 bg-emerald-950/60 rounded-lg px-2 py-1">
                        email:{e}
                      </li>
                    ))}
                    {data.envOperatorUids.map((u) => (
                      <li key={`u-${u}`} className="text-xs font-mono text-emerald-100 bg-emerald-950/60 rounded-lg px-2 py-1">
                        uid:{u}
                      </li>
                    ))}
                  </>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Audit log */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <History className="text-indigo-500" size={18} />
              Audit log
              <span className="text-[10px] font-mono text-slate-400 ml-2">{audit.length}</span>
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Last 100 events
            </span>
          </div>
          {auditError ? (
            <div className="p-6 text-xs text-rose-600 flex items-center gap-2">
              <AlertTriangle size={14} />
              {auditError}
            </div>
          ) : audit.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-slate-400 text-center">
              <ShieldAlert size={28} className="mb-2 opacity-40" />
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                No events recorded yet
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="text-left px-6 py-3">When</th>
                    <th className="text-left px-4 py-3">Action</th>
                    <th className="text-left px-4 py-3">Target</th>
                    <th className="text-left px-6 py-3">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a, i) => (
                    <tr key={`${a.ts}-${i}`} className="border-t border-slate-100">
                      <td className="px-6 py-3 text-xs text-slate-700 font-mono">
                        {formatDate(a.ts)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                            a.action === 'ADD'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {a.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-700">
                        {a.targetEmail}
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-500">
                        {a.actorEmail || a.actorUid}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
