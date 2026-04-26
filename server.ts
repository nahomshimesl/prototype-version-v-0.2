import express from "express";
import { createServer as createViteServer } from "vite";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Sentinel } from "./services/sentinel.js";

dotenv.config();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const PORT = Number(process.env.PORT) || 5000;

  app.use(express.json({ limit: "256kb" }));

  // Simple Password Protection Middleware
  const APP_PASSWORD = process.env.APP_PASSWORD || "organoid2026";
  const OPERATOR_ROOM = "operators";

  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${APP_PASSWORD}`) {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized. Please provide the correct access key." });
    }
  };

  // ───────────── Stability Sentinel ─────────────
  const sentinelAi = process.env.GEMINI_API_KEY
    ? {
        generate: async (prompt: string) => {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
          const res = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
          });
          return res.text ?? "";
        },
      }
    : null;
  const sentinel = new Sentinel({ io, ai: sentinelAi, operatorRoom: OPERATOR_ROOM });

  // Socket.io authentication. Connections without the operator token are still
  // accepted (so anonymous clients can be served the SPA via the same server),
  // but only authenticated sockets are added to the OPERATOR_ROOM where
  // sensitive diagnostic events are broadcast.
  io.use((socket, next) => {
    const token = (socket.handshake.auth as any)?.token
      || (socket.handshake.headers as any)?.["x-access-key"];
    socket.data.isOperator = token === APP_PASSWORD;
    next();
  });

  io.on("connection", (socket) => {
    if (socket.data.isOperator) {
      socket.join(OPERATOR_ROOM);
      console.log("Operator connected:", socket.id);
    } else {
      console.log("Anonymous client connected:", socket.id);
    }

    socket.on("join-session", (sessionId) => {
      // Session rooms are user-scoped collaboration rooms. Reject obviously
      // bogus values to prevent room-namespace abuse, and never let a client
      // join the operator room via this channel.
      if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128 || sessionId === OPERATOR_ROOM) return;
      socket.join(sessionId);
    });

    socket.on("disconnect", () => {
      // quiet — disconnect log was operator-noisy
    });
  });

  // ───────────── Per-IP rate limiting (in-memory sliding window) ─────────────
  // Used to throttle the deliberately-unauthenticated /api/sentinel/report
  // endpoint so anonymous callers cannot flood the incident store or evict
  // legitimate incidents from operator visibility.
  const reportRateBuckets = new Map<string, number[]>();
  const REPORT_RATE_WINDOW_MS = 60_000;
  const REPORT_RATE_MAX = 30; // 30 reports / minute / IP
  const rateLimitReport = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
    const now = Date.now();
    const cutoff = now - REPORT_RATE_WINDOW_MS;
    const arr = (reportRateBuckets.get(ip) || []).filter((t) => t >= cutoff);
    if (arr.length >= REPORT_RATE_MAX) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ ok: false, error: "Too many reports. Slow down." });
    }
    arr.push(now);
    reportRateBuckets.set(ip, arr);
    // Periodic cleanup of stale IPs
    if (reportRateBuckets.size > 5000) {
      for (const [k, v] of reportRateBuckets) {
        if (v.length === 0 || v[v.length - 1] < cutoff) reportRateBuckets.delete(k);
      }
    }
    next();
  };

  const sanitizeStr = (v: unknown, max: number): string | undefined => {
    if (v == null) return undefined;
    const s = String(v);
    return s.length > max ? s.slice(0, max) : s;
  };
  const ALLOWED_SEVERITY = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

  // Biological Simulation Endpoint
  app.post("/api/auth/verify", authMiddleware, (req, res) => {
    res.json({ success: true });
  });

  app.post("/api/simulate", authMiddleware, (req, res) => {
    const { glucose, oxygen, aminoAcids, temperature } = req.body;

    const baseMetabolism = (glucose * 0.4) + (oxygen * 0.3) + (aminoAcids * 0.3);
    const tempStress = Math.abs(temperature - 37) * 0.05;
    const healthScore = Math.max(0, Math.min(100, (baseMetabolism * 10) - (tempStress * 20)));

    const bottlenecks = [];
    if (glucose < 3) bottlenecks.push("Hypoglycemic Stress");
    if (oxygen < 5) bottlenecks.push("Hypoxic Environment");
    if (aminoAcids < 2) bottlenecks.push("Protein Synthesis Limitation");
    if (temperature > 40) bottlenecks.push("Thermal Denaturation Risk");
    if (temperature < 35) bottlenecks.push("Metabolic Stasis");

    const simulationData = {
      healthScore,
      bottlenecks,
      fluxRate: (baseMetabolism / 10).toFixed(2),
      timestamp: new Date().toISOString(),
      parameters: { glucose, oxygen, aminoAcids, temperature }
    };

    res.json(simulationData);
  });

  // System Health & Logging Endpoints
  let systemLogs: any[] = [];
  let systemHealth: any = { score: 100, status: "OK", lastUpdate: new Date().toISOString() };

  app.get("/api/system/health", authMiddleware, (req, res) => {
    res.json(systemHealth);
  });

  app.post("/api/system/health", authMiddleware, (req, res) => {
    systemHealth = { ...req.body, lastUpdate: new Date().toISOString() };
    io.to(OPERATOR_ROOM).emit('health-update', systemHealth);
    res.json({ status: "updated" });
  });

  app.get("/api/system/logs", authMiddleware, (req, res) => {
    res.json(systemLogs.slice(-100));
  });

  app.post("/api/system/logs", authMiddleware, (req, res) => {
    const log = { ...req.body, serverTimestamp: new Date().toISOString() };
    systemLogs.push(log);
    if (systemLogs.length > 500) systemLogs.shift();
    io.to(OPERATOR_ROOM).emit('log-added', log);
    res.json({ status: "logged" });
  });

  // ───────────── Sentinel API ─────────────
  // Reporting is intentionally unauthenticated so client errors during auth
  // failures still get captured, but it is rate-limited per IP, strictly
  // validated, and the resulting incidents are flagged as `untrusted` so they
  // get a separate eviction budget and cannot push trusted incidents out of
  // the operator-visible store. All read/mutate endpoints require auth.

  app.post("/api/sentinel/report", rateLimitReport, (req, res) => {
    try {
      const body = req.body ?? {};
      // Hard size/type validation. Anything beyond these caps is silently truncated.
      const sevRaw = sanitizeStr(body.severity, 16);
      const severity = sevRaw && ALLOWED_SEVERITY.has(sevRaw) ? (sevRaw as any) : "MEDIUM";

      // Bound context to a small JSON payload to prevent storage bloat.
      let safeContext: Record<string, unknown> | undefined = undefined;
      if (body.context && typeof body.context === "object") {
        try {
          const json = JSON.stringify(body.context);
          if (json.length <= 4000) safeContext = body.context;
          else safeContext = { _truncated: true, preview: json.slice(0, 1500) };
        } catch {
          safeContext = undefined;
        }
      }

      // Whether to treat the caller as trusted (operator) or anonymous.
      const trusted = req.headers.authorization === `Bearer ${APP_PASSWORD}`;

      const inc = sentinel.report({
        source: sanitizeStr(body.source, 64) ?? (trusted ? "browser" : "untrusted-browser"),
        kind: sanitizeStr(body.kind, 64),
        message: sanitizeStr(body.message, 1000) ?? "Unknown error",
        stack: sanitizeStr(body.stack, 8000),
        severity,
        context: safeContext,
        // Server time only — never trust client clocks for incident bookkeeping.
        timestamp: Date.now(),
        trusted,
      });
      res.json({ ok: true, id: inc.id, fingerprint: inc.fingerprint, occurrences: inc.occurrences });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message });
    }
  });

  app.get("/api/sentinel/incidents", authMiddleware, (_req, res) => res.json(sentinel.list()));
  app.get("/api/sentinel/incidents/:id", authMiddleware, (req, res) => {
    const inc = sentinel.get(req.params.id);
    if (!inc) return res.status(404).json({ error: "Not found" });
    res.json(inc);
  });
  app.get("/api/sentinel/anomalies", authMiddleware, (_req, res) => res.json(sentinel.listAnomalies()));
  app.get("/api/sentinel/stats", authMiddleware, (_req, res) => res.json(sentinel.stats()));
  app.get("/api/sentinel/recovery-actions", authMiddleware, (_req, res) => res.json(sentinel.listRecoveryActions()));

  app.post("/api/sentinel/incidents/:id/analyze", authMiddleware, async (req, res) => {
    const analysis = await sentinel.analyze(req.params.id, Boolean(req.body?.force));
    if (!analysis) return res.status(404).json({ error: "Not found" });
    res.json(analysis);
  });

  app.post("/api/sentinel/incidents/:id/recover", authMiddleware, async (req, res) => {
    const result = await sentinel.runRecovery(req.params.id, String(req.body?.action ?? ""));
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post("/api/sentinel/incidents/:id/acknowledge", authMiddleware, (req, res) => {
    const inc = sentinel.acknowledge(req.params.id);
    if (!inc) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Stability Sentinel armed (AI ${sentinelAi ? "enabled" : "heuristic-only"})`);
  });
}

startServer();
