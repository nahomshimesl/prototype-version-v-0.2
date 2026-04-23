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
  private accessKey = "organoid2026";

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

  setAccessKey(key: string) { this.accessKey = key; }

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

  async fetchIncidents() { return (await fetch("/api/sentinel/incidents")).json(); }
  async fetchAnomalies() { return (await fetch("/api/sentinel/anomalies")).json(); }
  async fetchStats() { return (await fetch("/api/sentinel/stats")).json(); }
  async fetchActions() { return (await fetch("/api/sentinel/recovery-actions")).json(); }

  async analyze(id: string, force = false) {
    const res = await fetch(`/api/sentinel/incidents/${id}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.accessKey}` },
      body: JSON.stringify({ force }),
    });
    if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
    return res.json();
  }

  async recover(id: string, action: string) {
    const res = await fetch(`/api/sentinel/incidents/${id}/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.accessKey}` },
      body: JSON.stringify({ action }),
    });
    return res.json();
  }

  async acknowledge(id: string) {
    return (await fetch(`/api/sentinel/incidents/${id}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessKey}` },
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
