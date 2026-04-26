/**
 * Stability Sentinel — server-side reliability subsystem.
 *
 * Responsibilities:
 *   - Capture errors from clients and the server process
 *   - Deduplicate via fingerprints, track recurrence
 *   - Detect runtime anomalies (memory spikes, event-loop block, error-rate)
 *   - Run AI root-cause analysis (Gemini), cache per fingerprint
 *   - Expose safe, approval-gated recovery actions
 *   - Persist incident memory across restarts
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import type { Server as IOServer } from "socket.io";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type IncidentStatus = "OPEN" | "ANALYZING" | "ACKNOWLEDGED" | "RESOLVED";

export interface DiagnosticContext {
  url?: string;
  userAgent?: string;
  route?: string;
  userId?: string;
  appVersion?: string;
  actionHistory?: string[];
  systemSnapshot?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface RawErrorReport {
  source: string;             // e.g. "browser", "react-error-boundary", "server"
  kind?: string;              // e.g. "TypeError", "NetworkError", "MemorySpike"
  message: string;
  stack?: string;
  severity?: Severity;
  context?: DiagnosticContext;
  timestamp?: number;
  /**
   * Trust flag.
   *  - `true`: server-internal report or one accompanied by a valid operator
   *    token. Counts toward the trusted incident budget. Can raise
   *    RECURRING_ERROR anomalies and use any severity (including CRITICAL).
   *  - `false` (default): anonymous public reports from /api/sentinel/report.
   *    Severity is capped at HIGH, RECURRING_ERROR escalation is suppressed,
   *    and the incident is held in a smaller untrusted bucket so flooding
   *    cannot evict trusted incidents from operator visibility.
   */
  trusted?: boolean;
}

export interface FixSuggestion {
  title: string;
  detail: string;
  confidence: number;   // 0..1
  safety: "SAFE" | "REVIEW" | "RISKY";
  recoveryAction?: string; // matches a registered RecoveryAction id
}

export interface RootCauseAnalysis {
  summary: string;          // plain-language root cause
  category: string;         // e.g. "Network", "State", "Memory", "Logic"
  fixes: FixSuggestion[];
  generatedAt: number;
  model?: string;
}

export interface Incident {
  id: string;
  fingerprint: string;
  source: string;
  kind: string;
  message: string;
  stack?: string;
  severity: Severity;
  status: IncidentStatus;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  contexts: DiagnosticContext[];   // bounded ring of recent contexts
  analysis?: RootCauseAnalysis;
  recoveryHistory: { action: string; at: number; ok: boolean; note?: string }[];
  /**
   * Whether this incident originated from a trusted (server-side or
   * authenticated-operator) source. Untrusted incidents are isolated into
   * their own eviction bucket so anonymous reports cannot push trusted
   * incidents out of the store. Defaults to `true` for backward compat with
   * incidents loaded from older persisted stores.
   */
  trusted: boolean;
}

export interface Anomaly {
  id: string;
  type: "MEMORY_SPIKE" | "EVENT_LOOP_BLOCK" | "ERROR_RATE_HIGH" | "RECURRING_ERROR";
  severity: Severity;
  message: string;
  detectedAt: number;
  metrics: Record<string, number>;
  resolved?: boolean;
}

export interface RecoveryAction {
  id: string;
  label: string;
  safety: "SAFE" | "REVIEW" | "RISKY";
  description: string;
  run: (incident: Incident) => Promise<{ ok: boolean; note?: string }>;
}

interface SentinelOptions {
  storePath?: string;
  maxIncidents?: number;
  maxContextsPerIncident?: number;
  /**
   * Maximum incident slots reserved for untrusted (anonymous) reports. Held
   * in a separate eviction bucket so flooding cannot evict trusted incidents.
   * Defaults to ~20% of maxIncidents.
   */
  maxUntrustedIncidents?: number;
  errorRateWindowMs?: number;
  errorRateThreshold?: number;     // errors per minute
  memorySpikeRatio?: number;       // RSS growth ratio over baseline
  eventLoopBlockMs?: number;
  recurrenceThreshold?: number;
  io?: IOServer;
  ai?: { generate: (prompt: string) => Promise<string> } | null;
  /**
   * Socket.IO room that receives sensitive sentinel:* broadcasts. When set,
   * `emit()` only delivers to sockets in this room (i.e. authenticated
   * operators) instead of every connected socket.
   */
  operatorRoom?: string | null;
}

export class Sentinel {
  private incidents = new Map<string, Incident>();
  private anomalies: Anomaly[] = [];
  private recoveryActions = new Map<string, RecoveryAction>();
  private errorTimestamps: number[] = [];
  private rssBaseline = 0;
  private opts: Required<Omit<SentinelOptions, "io" | "ai" | "operatorRoom">> & {
    io: IOServer | null;
    ai: SentinelOptions["ai"];
    operatorRoom: string | null;
  };
  private monitorTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private analysisInflight = new Map<string, Promise<RootCauseAnalysis>>();

  constructor(opts: SentinelOptions = {}) {
    const maxIncidents = opts.maxIncidents ?? 500;
    this.opts = {
      storePath: opts.storePath ?? path.join(process.cwd(), ".local", "sentinel-store.json"),
      maxIncidents,
      maxUntrustedIncidents: opts.maxUntrustedIncidents ?? Math.max(20, Math.floor(maxIncidents * 0.2)),
      maxContextsPerIncident: opts.maxContextsPerIncident ?? 10,
      errorRateWindowMs: opts.errorRateWindowMs ?? 60_000,
      errorRateThreshold: opts.errorRateThreshold ?? 20,
      memorySpikeRatio: opts.memorySpikeRatio ?? 1.6,
      eventLoopBlockMs: opts.eventLoopBlockMs ?? 500,
      recurrenceThreshold: opts.recurrenceThreshold ?? 5,
      io: opts.io ?? null,
      ai: opts.ai ?? null,
      operatorRoom: opts.operatorRoom ?? null,
    };
    this.load();
    this.registerDefaultRecoveryActions();
    this.startMonitoring();
    this.attachProcessHandlers();
  }

  // ───────────────────────────── Reporting ─────────────────────────────

  report(raw: RawErrorReport): Incident {
    // Trust gate: untrusted (anonymous public) reports never use the
    // caller-supplied timestamp, are capped at HIGH severity, and are kept
    // separate from operator/server-originated incidents in storage.
    const trusted = raw.trusted !== false; // default true for back-compat
    const ts = trusted ? (raw.timestamp ?? Date.now()) : Date.now();

    const cappedSeverityIncoming: Severity | undefined = trusted
      ? raw.severity
      : raw.severity === "CRITICAL" ? "HIGH" : raw.severity;

    // Fingerprint untrusted reports into a separate keyspace so an attacker
    // cannot fingerprint-collide with a known trusted incident and inject
    // misleading occurrences/contexts into it.
    const fpSeed = this.fingerprint(raw);
    const fingerprint = trusted ? fpSeed : `u:${fpSeed}`;
    const existing = this.incidents.get(fingerprint);
    const id = existing?.id ?? `inc_${crypto.randomBytes(5).toString("hex")}`;

    const incident: Incident = existing ?? {
      id,
      fingerprint,
      source: raw.source,
      kind: raw.kind ?? this.inferKind(raw.message, raw.stack),
      message: raw.message,
      stack: raw.stack,
      severity: cappedSeverityIncoming ?? "MEDIUM",
      status: "OPEN",
      firstSeen: ts,
      lastSeen: ts,
      occurrences: 0,
      contexts: [],
      recoveryHistory: [],
      trusted,
    };

    incident.lastSeen = ts;
    incident.occurrences += 1;
    incident.severity = this.escalateSeverity(incident.severity, cappedSeverityIncoming);
    if (raw.context) {
      incident.contexts.unshift({ ...raw.context, _t: ts });
      if (incident.contexts.length > this.opts.maxContextsPerIncident) incident.contexts.length = this.opts.maxContextsPerIncident;
    }
    if (raw.stack && !incident.stack) incident.stack = raw.stack;

    this.incidents.set(fingerprint, incident);
    this.evictIfNeeded();
    // Only count trusted incidents toward the operator-visible error rate, so
    // an anonymous flood cannot trigger ERROR_RATE_HIGH for the operators.
    if (trusted) this.errorTimestamps.push(ts);
    this.emit("sentinel:incident", this.publicIncident(incident));
    // RECURRING_ERROR escalation is reserved for trusted incidents — anonymous
    // callers cannot use it to manufacture HIGH-severity anomalies.
    if (trusted && incident.occurrences >= this.opts.recurrenceThreshold) {
      this.raiseAnomaly({
        type: "RECURRING_ERROR",
        severity: "HIGH",
        message: `Recurring error: "${incident.message}" seen ${incident.occurrences}× (${incident.kind})`,
        metrics: { occurrences: incident.occurrences },
      });
    }
    this.scheduleSave();
    return incident;
  }

  list(): Incident[] {
    return Array.from(this.incidents.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  get(id: string): Incident | undefined {
    for (const inc of this.incidents.values()) if (inc.id === id) return inc;
    return undefined;
  }

  acknowledge(id: string): Incident | undefined {
    const inc = this.get(id);
    if (!inc) return undefined;
    inc.status = "ACKNOWLEDGED";
    this.emit("sentinel:incident", this.publicIncident(inc));
    this.scheduleSave();
    return inc;
  }

  resolve(id: string): Incident | undefined {
    const inc = this.get(id);
    if (!inc) return undefined;
    inc.status = "RESOLVED";
    this.emit("sentinel:resolved", { id: inc.id });
    this.scheduleSave();
    return inc;
  }

  // ───────────────────────────── AI Analysis ─────────────────────────────

  async analyze(id: string, force = false): Promise<RootCauseAnalysis | null> {
    const inc = this.get(id);
    if (!inc) return null;
    if (!force && inc.analysis && Date.now() - inc.analysis.generatedAt < 5 * 60_000) return inc.analysis;

    if (this.analysisInflight.has(inc.fingerprint)) return this.analysisInflight.get(inc.fingerprint)!;
    inc.status = "ANALYZING";
    this.emit("sentinel:incident", this.publicIncident(inc));

    const promise = this.runAnalysis(inc).then(
      (analysis) => {
        inc.analysis = analysis;
        inc.status = inc.status === "ANALYZING" ? "OPEN" : inc.status;
        this.emit("sentinel:analysis", { id: inc.id, analysis });
        this.scheduleSave();
        this.analysisInflight.delete(inc.fingerprint);
        return analysis;
      },
      (err) => {
        this.analysisInflight.delete(inc.fingerprint);
        const fallback = this.heuristicAnalysis(inc, String(err?.message || err));
        inc.analysis = fallback;
        this.emit("sentinel:analysis", { id: inc.id, analysis: fallback });
        this.scheduleSave();
        return fallback;
      },
    );
    this.analysisInflight.set(inc.fingerprint, promise);
    return promise;
  }

  private async runAnalysis(inc: Incident): Promise<RootCauseAnalysis> {
    if (!this.opts.ai) return this.heuristicAnalysis(inc, "AI engine not configured");
    const prompt = this.buildAnalysisPrompt(inc);
    const text = await this.opts.ai.generate(prompt);
    return this.parseAnalysis(text, inc) ?? this.heuristicAnalysis(inc, "AI returned unparseable response");
  }

  private buildAnalysisPrompt(inc: Incident): string {
    const ctx = inc.contexts[0] ? JSON.stringify(inc.contexts[0]).slice(0, 1500) : "(none)";
    const stack = inc.stack ? inc.stack.split("\n").slice(0, 8).join("\n") : "(no stack)";
    return `You are a senior reliability engineer diagnosing a production error.
Return STRICT JSON only with shape:
{
  "summary": string,           // plain-language root cause, 1-3 sentences
  "category": string,          // one of: Network, State, Memory, Logic, Auth, Config, External, Unknown
  "fixes": [
    { "title": string, "detail": string, "confidence": number, "safety": "SAFE"|"REVIEW"|"RISKY", "recoveryAction": string|null }
  ]
}
Rank fixes by confidence DESC. Mark anything that mutates production data or restarts services as REVIEW or RISKY. Include 1-4 fixes.

INCIDENT
  source: ${inc.source}
  kind: ${inc.kind}
  severity: ${inc.severity}
  occurrences: ${inc.occurrences}
  message: ${inc.message}
  stack:
${stack}
  recent context: ${ctx}
`;
  }

  private parseAnalysis(text: string, inc: Incident): RootCauseAnalysis | null {
    try {
      const json = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      const obj = JSON.parse(json);
      if (!obj || typeof obj.summary !== "string") return null;
      const fixes: FixSuggestion[] = Array.isArray(obj.fixes)
        ? obj.fixes.slice(0, 6).map((f: any) => ({
            title: String(f.title ?? "Suggested fix"),
            detail: String(f.detail ?? ""),
            confidence: Math.max(0, Math.min(1, Number(f.confidence ?? 0.5))),
            safety: (["SAFE", "REVIEW", "RISKY"].includes(f.safety) ? f.safety : "REVIEW") as FixSuggestion["safety"],
            recoveryAction: f.recoveryAction && this.recoveryActions.has(f.recoveryAction) ? f.recoveryAction : undefined,
          }))
        : [];
      return {
        summary: obj.summary,
        category: obj.category ?? "Unknown",
        fixes,
        generatedAt: Date.now(),
        model: "gemini",
      };
    } catch {
      return null;
    }
  }

  private heuristicAnalysis(inc: Incident, note: string): RootCauseAnalysis {
    const m = inc.message.toLowerCase();
    let category = "Unknown";
    const fixes: FixSuggestion[] = [];
    if (/network|fetch|econn|timeout|unavailable/.test(m)) {
      category = "Network";
      fixes.push({ title: "Retry with backoff", detail: "Wrap the call in exponential backoff and surface a user-visible offline state.", confidence: 0.6, safety: "SAFE", recoveryAction: "retry" });
    }
    if (/undefined|null|cannot read|is not a function/.test(m)) {
      category = "State";
      fixes.push({ title: "Add null/undefined guard", detail: "Add defensive checks at the failing access; verify state initialization order.", confidence: 0.55, safety: "SAFE" });
    }
    if (/memory|heap|out of memory|spike/.test(m)) {
      category = "Memory";
      fixes.push({ title: "Hint garbage collection", detail: "Trigger GC and audit retained references in long-lived buffers.", confidence: 0.4, safety: "REVIEW", recoveryAction: "gc-hint" });
    }
    if (fixes.length === 0) fixes.push({ title: "Investigate manually", detail: `No automated heuristic matched. ${note}`, confidence: 0.2, safety: "SAFE" });
    return { summary: `Heuristic diagnosis: ${inc.kind} from ${inc.source}. ${note}`, category, fixes, generatedAt: Date.now() };
  }

  // ───────────────────────────── Recovery ─────────────────────────────

  registerRecoveryAction(action: RecoveryAction) {
    this.recoveryActions.set(action.id, action);
  }

  listRecoveryActions(): Omit<RecoveryAction, "run">[] {
    return Array.from(this.recoveryActions.values()).map(({ run, ...rest }) => rest);
  }

  async runRecovery(incidentId: string, actionId: string): Promise<{ ok: boolean; note?: string }> {
    const inc = this.get(incidentId);
    if (!inc) return { ok: false, note: "Incident not found" };
    const action = this.recoveryActions.get(actionId);
    if (!action) return { ok: false, note: "Unknown recovery action" };
    if (action.safety === "RISKY") return { ok: false, note: "RISKY actions require manual execution" };
    let result: { ok: boolean; note?: string };
    try {
      result = await action.run(inc);
    } catch (e: any) {
      result = { ok: false, note: e?.message ?? "Recovery threw" };
    }
    inc.recoveryHistory.push({ action: actionId, at: Date.now(), ok: result.ok, note: result.note });
    if (result.ok) inc.status = "RESOLVED";
    this.emit("sentinel:incident", this.publicIncident(inc));
    this.scheduleSave();
    return result;
  }

  private registerDefaultRecoveryActions() {
    this.registerRecoveryAction({
      id: "acknowledge",
      label: "Acknowledge",
      safety: "SAFE",
      description: "Mark this incident as acknowledged without changing system state.",
      run: async (inc) => { inc.status = "ACKNOWLEDGED"; return { ok: true, note: "Acknowledged" }; },
    });
    this.registerRecoveryAction({
      id: "resolve",
      label: "Mark resolved",
      safety: "SAFE",
      description: "Mark this incident as resolved.",
      run: async (inc) => { inc.status = "RESOLVED"; return { ok: true, note: "Resolved manually" }; },
    });
    this.registerRecoveryAction({
      id: "retry",
      label: "Hint client retry",
      safety: "SAFE",
      description: "Broadcasts a retry hint over the websocket; the client decides whether to act on it.",
      run: async (inc) => {
        this.emit("sentinel:retry-hint", { id: inc.id, fingerprint: inc.fingerprint });
        return { ok: true, note: "Retry hint broadcast" };
      },
    });
    this.registerRecoveryAction({
      id: "reset-client-state",
      label: "Request client local-state reset",
      safety: "REVIEW",
      description: "Tells connected clients to reset their non-persistent local state.",
      run: async (inc) => {
        this.emit("sentinel:reset-state-hint", { id: inc.id, fingerprint: inc.fingerprint });
        return { ok: true, note: "Reset hint broadcast" };
      },
    });
    this.registerRecoveryAction({
      id: "gc-hint",
      label: "Hint server garbage collection",
      safety: "SAFE",
      description: "Triggers V8 GC if --expose-gc is enabled. Otherwise no-ops safely.",
      run: async () => {
        const g = global as any;
        if (typeof g.gc === "function") { g.gc(); return { ok: true, note: "GC invoked" }; }
        return { ok: true, note: "GC not exposed; no-op" };
      },
    });
  }

  // ───────────────────────────── Anomaly Detection ─────────────────────────────

  private startMonitoring() {
    if (this.monitorTimer) return;
    this.rssBaseline = process.memoryUsage().rss;
    let lastTick = performance.now();
    this.monitorTimer = setInterval(() => {
      const now = performance.now();
      const drift = now - lastTick - 2000; // expected interval
      lastTick = now;
      if (drift > this.opts.eventLoopBlockMs) {
        this.raiseAnomaly({
          type: "EVENT_LOOP_BLOCK",
          severity: drift > 2000 ? "CRITICAL" : "HIGH",
          message: `Event loop blocked for ~${Math.round(drift)}ms`,
          metrics: { driftMs: Math.round(drift) },
        });
      }
      const mem = process.memoryUsage();
      if (this.rssBaseline > 0 && mem.rss / this.rssBaseline > this.opts.memorySpikeRatio) {
        this.raiseAnomaly({
          type: "MEMORY_SPIKE",
          severity: "HIGH",
          message: `RSS memory at ${(mem.rss / 1024 / 1024).toFixed(1)}MB (${(mem.rss / this.rssBaseline).toFixed(2)}× baseline)`,
          metrics: { rssMB: Math.round(mem.rss / 1024 / 1024), baselineMB: Math.round(this.rssBaseline / 1024 / 1024) },
        });
        this.rssBaseline = Math.max(this.rssBaseline, mem.rss * 0.9); // adapt baseline
      }
      // sliding-window error rate
      const cutoff = Date.now() - this.opts.errorRateWindowMs;
      this.errorTimestamps = this.errorTimestamps.filter((t) => t >= cutoff);
      const rate = this.errorTimestamps.length;
      if (rate >= this.opts.errorRateThreshold) {
        this.raiseAnomaly({
          type: "ERROR_RATE_HIGH",
          severity: "HIGH",
          message: `Error rate ${rate}/min exceeds threshold ${this.opts.errorRateThreshold}`,
          metrics: { errorsPerMinute: rate },
        });
      }
    }, 2000).unref?.() as any;
  }

  private raiseAnomaly(a: Omit<Anomaly, "id" | "detectedAt">) {
    // Deduplicate by type within 30s
    const recent = this.anomalies.find((x) => x.type === a.type && !x.resolved && Date.now() - x.detectedAt < 30_000);
    if (recent) return;
    const anomaly: Anomaly = { id: `an_${crypto.randomBytes(4).toString("hex")}`, detectedAt: Date.now(), ...a };
    this.anomalies.unshift(anomaly);
    if (this.anomalies.length > 200) this.anomalies.length = 200;
    this.emit("sentinel:anomaly", anomaly);
  }

  listAnomalies(): Anomaly[] { return this.anomalies.slice(0, 100); }

  stats() {
    const cutoff = Date.now() - this.opts.errorRateWindowMs;
    const mem = process.memoryUsage();
    return {
      incidents: this.incidents.size,
      openIncidents: Array.from(this.incidents.values()).filter((i) => i.status === "OPEN" || i.status === "ANALYZING").length,
      errorsLastMinute: this.errorTimestamps.filter((t) => t >= cutoff).length,
      anomalies: this.anomalies.filter((a) => !a.resolved).length,
      memory: { rssMB: Math.round(mem.rss / 1024 / 1024), heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024) },
      uptimeSec: Math.round(process.uptime()),
    };
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private attachProcessHandlers() {
    process.on("uncaughtException", (err) => {
      this.report({ source: "server", kind: err.name || "UncaughtException", message: err.message, stack: err.stack, severity: "CRITICAL", trusted: true });
    });
    process.on("unhandledRejection", (reason: any) => {
      this.report({ source: "server", kind: reason?.name || "UnhandledRejection", message: String(reason?.message ?? reason), stack: reason?.stack, severity: "HIGH", trusted: true });
    });
  }

  private fingerprint(r: RawErrorReport): string {
    const topFrame = (r.stack || "").split("\n").find((l) => l.trim().startsWith("at ")) || "";
    const norm = (r.message || "")
      .replace(/0x[0-9a-f]+/gi, "0xX")
      .replace(/\b\d{2,}\b/g, "N")
      .replace(/https?:\/\/\S+/g, "URL")
      .slice(0, 200);
    return crypto.createHash("sha1").update(`${r.source}|${r.kind ?? ""}|${norm}|${topFrame.trim()}`).digest("hex").slice(0, 16);
  }

  private inferKind(message: string, stack?: string): string {
    const m = (stack?.split("\n")[0] || message).match(/^([A-Z][A-Za-z]*Error)/);
    return m?.[1] ?? "Error";
  }

  private escalateSeverity(current: Severity, incoming?: Severity): Severity {
    const order: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    if (!incoming) return current;
    return order[Math.max(order.indexOf(current), order.indexOf(incoming))];
  }

  private publicIncident(inc: Incident) {
    return { ...inc, contexts: inc.contexts.slice(0, 3) };
  }

  private emit(event: string, payload: unknown) {
    try {
      const io = this.opts.io;
      if (!io) return;
      // Sensitive sentinel telemetry is only sent to authenticated operator
      // sockets when an operator room is configured. Unauthenticated
      // listeners therefore never receive incident contents, anomalies,
      // analyses, or recovery hints over the websocket.
      if (this.opts.operatorRoom) io.to(this.opts.operatorRoom).emit(event, payload);
      else io.emit(event, payload);
    } catch { /* socket optional */ }
  }

  private evictIfNeeded() {
    // Two-bucket eviction. Trusted and untrusted incidents have independent
    // budgets so an anonymous flood cannot push real operator incidents out
    // of the store. We sort each bucket by lastSeen ASC and drop the oldest
    // overflow from each side.
    const trusted: Incident[] = [];
    const untrusted: Incident[] = [];
    for (const inc of this.incidents.values()) {
      (inc.trusted === false ? untrusted : trusted).push(inc);
    }
    const dropOldest = (bucket: Incident[], cap: number) => {
      if (bucket.length <= cap) return;
      bucket.sort((a, b) => a.lastSeen - b.lastSeen);
      const overflow = bucket.length - cap;
      for (let i = 0; i < overflow; i++) this.incidents.delete(bucket[i].fingerprint);
    };
    // Trusted bucket: keep maxIncidents - maxUntrustedIncidents reserved capacity.
    const trustedCap = Math.max(1, this.opts.maxIncidents - this.opts.maxUntrustedIncidents);
    dropOldest(trusted, trustedCap);
    dropOldest(untrusted, this.opts.maxUntrustedIncidents);
  }

  // ───────────────────────────── Persistence ─────────────────────────────

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1500);
    (this.saveTimer as any).unref?.();
  }

  private save() {
    try {
      const dir = path.dirname(this.opts.storePath);
      fs.mkdirSync(dir, { recursive: true });
      const payload = {
        savedAt: Date.now(),
        incidents: Array.from(this.incidents.values()).slice(-this.opts.maxIncidents),
      };
      fs.writeFileSync(this.opts.storePath, JSON.stringify(payload));
    } catch (e) {
      // Persistence is best-effort; never crash the app for it.
      console.warn("[sentinel] persist failed:", (e as Error).message);
    }
  }

  private load() {
    try {
      if (!fs.existsSync(this.opts.storePath)) return;
      const raw = fs.readFileSync(this.opts.storePath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data?.incidents)) {
        for (const inc of data.incidents) {
          // Backfill `trusted` for incidents persisted before the trust split
          // existed. Anything from before is treated as trusted (operator).
          if (typeof inc.trusted !== "boolean") inc.trusted = true;
          this.incidents.set(inc.fingerprint, inc);
        }
      }
    } catch (e) {
      console.warn("[sentinel] load failed:", (e as Error).message);
    }
  }

  setIo(io: IOServer) { this.opts.io = io; }
  setAi(ai: SentinelOptions["ai"]) { this.opts.ai = ai ?? null; }
}
