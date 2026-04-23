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
  const sentinel = new Sentinel({ io, ai: sentinelAi });

  // Socket.io for Real-time Communication
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("join-session", (sessionId) => {
      socket.join(sessionId);
      console.log(`Client ${socket.id} joined session ${sessionId}`);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // Simple Password Protection Middleware
  const APP_PASSWORD = process.env.APP_PASSWORD || "organoid2026";

  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${APP_PASSWORD}`) {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized. Please provide the correct access key." });
    }
  };

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

  app.get("/api/system/health", (req, res) => {
    res.json(systemHealth);
  });

  app.post("/api/system/health", authMiddleware, (req, res) => {
    systemHealth = { ...req.body, lastUpdate: new Date().toISOString() };
    io.emit('health-update', systemHealth);
    res.json({ status: "updated" });
  });

  app.get("/api/system/logs", (req, res) => {
    res.json(systemLogs.slice(-100));
  });

  app.post("/api/system/logs", authMiddleware, (req, res) => {
    const log = { ...req.body, serverTimestamp: new Date().toISOString() };
    systemLogs.push(log);
    if (systemLogs.length > 500) systemLogs.shift();
    io.emit('log-added', log);
    res.json({ status: "logged" });
  });

  // ───────────── Sentinel API ─────────────
  // Reporting is intentionally unauthenticated so client errors during auth
  // failures still get captured. Mutating endpoints require auth.

  app.post("/api/sentinel/report", (req, res) => {
    try {
      const inc = sentinel.report({
        source: String(req.body?.source ?? "browser"),
        kind: req.body?.kind,
        message: String(req.body?.message ?? "Unknown error"),
        stack: req.body?.stack,
        severity: req.body?.severity,
        context: req.body?.context,
        timestamp: req.body?.timestamp,
      });
      res.json({ ok: true, id: inc.id, fingerprint: inc.fingerprint, occurrences: inc.occurrences });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message });
    }
  });

  app.get("/api/sentinel/incidents", (_req, res) => res.json(sentinel.list()));
  app.get("/api/sentinel/incidents/:id", (req, res) => {
    const inc = sentinel.get(req.params.id);
    if (!inc) return res.status(404).json({ error: "Not found" });
    res.json(inc);
  });
  app.get("/api/sentinel/anomalies", (_req, res) => res.json(sentinel.listAnomalies()));
  app.get("/api/sentinel/stats", (_req, res) => res.json(sentinel.stats()));
  app.get("/api/sentinel/recovery-actions", (_req, res) => res.json(sentinel.listRecoveryActions()));

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
