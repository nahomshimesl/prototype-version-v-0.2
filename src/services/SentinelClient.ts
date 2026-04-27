/**
 * Stability Sentinel — browser client.
 *
 * - Captures window errors, unhandled rejections, and ErrorBoundary reports.
 * - Maintains a rolling action history for diagnostic context.
 * - Sends reports to /api/sentinel/report (no auth needed).
 * - Subscribes to live sentinel:* socket events.
 * - Optional safe recovery handlers (retry / reset-local-state).
 */

import type { Socket } from "socket.io-client";

export type SentinelSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SentinelReport {
  source: string;
  kind?: string;
  message: string;
  stack?: string;
  severity?: SentinelSeverity;
  context?: Record<string, unknown>;
}

type Listener = (event: string, payload: any) => void;

class SentinelClientImpl {
  private actionHistory: string[] = [];
  private listeners = new Set<Listener>();
  private installed = false;
  private retryHandlers = new Set<(payload: any) => void>();
  private resetHandlers = new Set<() => void>();
  // Per-user Firebase ID token provider. Returns null if there is no signed-in
  // operator; in that case, mutate calls (analyze/recover/acknowledge) will
  // fail fast with a clear "not signed in" error rather than blasting the
  // server with unauthenticated requests.
  private getIdToken: (() => Promise<string | null>) | null = null;

  install(socket?: Socket | null) {
    if (this.installed) return;
    this.installed = true;

    window.addEventListener("error", (ev) => {
      this.report({
        source: "browser",
        kind: ev.error?.name || "WindowError",
        message: ev.message || "Window error",
        stack: ev.error?.stack,
        severity: "HIGH",
        context: this.snapshot({ filename: ev.filename, lineno: ev.lineno, colno: ev.colno }),
      });
    });

    window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
      const reason: any = ev.reason;
      this.report({
        source: "browser",
        kind: reason?.name || "UnhandledRejection",
        message: String(reason?.message ?? reason ?? "Unhandled promise rejection"),
        stack: reason?.stack,
        severity: "HIGH",
        context: this.snapshot(),
      });
    });

    if (socket) {
      const forward = (event: string) => (payload: any) => {
        this.listeners.forEach((l) => l(event, payload));
        if (event === "sentinel:retry-hint") this.retryHandlers.forEach((h) => h(payload));
        if (event === "sentinel:reset-state-hint") this.resetHandlers.forEach((h) => h());
      };
      socket.on("sentinel:incident", forward("sentinel:incident"));
      socket.on("sentinel:anomaly", forward("sentinel:anomaly"));
      socket.on("sentinel:analysis", forward("sentinel:analysis"));
      socket.on("sentinel:resolved", forward("sentinel:resolved"));
      socket.on("sentinel:retry-hint", forward("sentinel:retry-hint"));
      socket.on("sentinel:reset-state-hint", forward("sentinel:reset-state-hint"));
    }
  }

  setTokenProvider(getIdToken: (() => Promise<string | null>) | null) {
    this.getIdToken = getIdToken;
  }

  private async authHeader(): Promise<Record<string, string>> {
    if (!this.getIdToken) throw new Error("Operator sign-in required.");
    const token = await this.getIdToken();
    if (!token) throw new Error("Operator sign-in required.");
    return { Authorization: `Bearer ${token}` };
  }

  trackAction(name: string) {
    this.actionHistory.unshift(`${new Date().toISOString().slice(11, 19)} ${name}`);
    if (this.actionHistory.length > 25) this.actionHistory.length = 25;
  }

  onEvent(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  onRetryHint(h: (payload: any) => void) { this.retryHandlers.add(h); return () => this.retryHandlers.delete(h); }
  onResetHint(h: () => void) { this.resetHandlers.add(h); return () => this.resetHandlers.delete(h); }

  async report(r: SentinelReport): Promise<void> {
    const body = { ...r, context: { ...(r.context || {}), actionHistory: this.actionHistory.slice(0, 12) }, timestamp: Date.now() };
    try {
      await fetch("/api/sentinel/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // last-resort: drop silently — never let reporting itself crash the app
    }
  }

  // Sentinel read endpoints are operator-gated server-side, so every fetch
  // must carry the per-user ID token. authHeader() throws "Operator sign-in
  // required." when no operator is signed in, which the dashboard catches
  // and surfaces as an empty state rather than spamming 401s.
  async fetchIncidents() {
    const auth = await this.authHeader();
    return (await fetch("/api/sentinel/incidents", { headers: auth })).json();
  }
  async fetchAnomalies() {
    const auth = await this.authHeader();
    return (await fetch("/api/sentinel/anomalies", { headers: auth })).json();
  }
  async fetchStats() {
    const auth = await this.authHeader();
    return (await fetch("/api/sentinel/stats", { headers: auth })).json();
  }
  async fetchActions() {
    const auth = await this.authHeader();
    return (await fetch("/api/sentinel/recovery-actions", { headers: auth })).json();
  }

  async analyze(id: string, force = false) {
    const auth = await this.authHeader();
    const res = await fetch(`/api/sentinel/incidents/${id}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ force }),
    });
    if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
    return res.json();
  }

  async recover(id: string, action: string) {
    const auth = await this.authHeader();
    const res = await fetch(`/api/sentinel/incidents/${id}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ action }),
    });
    return res.json();
  }

  async acknowledge(id: string) {
    const auth = await this.authHeader();
    return (await fetch(`/api/sentinel/incidents/${id}/acknowledge`, {
      method: "POST",
      headers: { ...auth },
    })).json();
  }

  private snapshot(extra: Record<string, unknown> = {}) {
    return {
      url: location.href,
      route: location.pathname,
      userAgent: navigator.userAgent,
      viewport: `${innerWidth}x${innerHeight}`,
      ...extra,
    };
  }
}

export const SentinelClient = new SentinelClientImpl();
