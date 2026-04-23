import express from "express";
import { createServer as createViteServer } from "vite";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const PORT = 3000;

  app.use(express.json());

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

    // Simulation logic: Metabolic Flux Model
    // Simple heuristic for biological complexity
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
    io.emit('health-update', systemHealth); // Emit real-time update
    res.json({ status: "updated" });
  });

  app.get("/api/system/logs", (req, res) => {
    res.json(systemLogs.slice(-100));
  });

  app.post("/api/system/logs", authMiddleware, (req, res) => {
    const log = { ...req.body, serverTimestamp: new Date().toISOString() };
    systemLogs.push(log);
    if (systemLogs.length > 500) systemLogs.shift();
    io.emit('log-added', log); // Emit real-time log
    res.json({ status: "logged" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
  });
}

startServer();
