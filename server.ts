import express from "express";
import { createServer as createViteServer } from "vite";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { readFileSync } from "fs";
import dotenv from "dotenv";
import { initializeApp, cert, getApps, type App as AdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth, type DecodedIdToken } from "firebase-admin/auth";
import { Sentinel } from "./services/sentinel.js";
import * as db from "./services/db.js";
import { createAllowList } from "./services/operatorAllowList.js";

dotenv.config();

// ───────────── Firebase Admin (per-user operator auth) ─────────────
// We verify the caller's Firebase ID token on every operator request and
// check it against an explicit allow-list. The Admin SDK's verifyIdToken
// only needs a project ID — Google's token-signing public keys are fetched
// from a public endpoint — so a service-account credential is optional.
// If FIREBASE_SERVICE_ACCOUNT (JSON) is provided, we use it; otherwise we
// initialize with projectId only, which is sufficient for token verification.
const firebaseConfig = JSON.parse(
  readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf-8"),
) as { projectId: string };

function initAdminApp(): AdminApp {
  if (getApps().length > 0) return getApps()[0]!;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (sa && sa.trim().length > 0) {
    try {
      const parsed = JSON.parse(sa);
      return initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || firebaseConfig.projectId,
      });
    } catch (e) {
      console.warn(
        "FIREBASE_SERVICE_ACCOUNT was set but could not be parsed as JSON; falling back to projectId-only init.",
        (e as Error)?.message,
      );
    }
  }
  return initializeApp({ projectId: firebaseConfig.projectId });
}

const adminApp = initAdminApp();
const adminAuth = getAdminAuth(adminApp);

// Operator allow-list. Either or both env vars may be set; entries are
// trimmed and lower-cased for emails. If both are empty in production the
// server refuses to boot — otherwise no one would be able to authenticate.
function parseList(envVal: string | undefined, lower: boolean): Set<string> {
  if (!envVal) return new Set();
  return new Set(
    envVal
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (lower ? s.toLowerCase() : s)),
  );
}
const OPERATOR_EMAILS = parseList(process.env.OPERATOR_EMAILS, true);
const OPERATOR_UIDS = parseList(process.env.OPERATOR_UIDS, false);
// Owner allow-list. Owners are always operators AND can manage the dynamic
// operator allow-list at runtime via the Admin tab. Owner status is sourced
// strictly from this env var (not Firestore) so an owner cannot be silently
// removed by a compromised client / DB write.
const OWNER_EMAILS = parseList(process.env.OWNER_EMAILS, true);

// Optional break-glass shared password. This intentionally has no default
// fallback: if the env var is unset, the break-glass path is fully closed.
// It exists only so an operator can recover access if Firebase Auth itself
// is unavailable. Keep this rotated and short-lived.
const BREAK_GLASS_PASSWORD = process.env.APP_PASSWORD_BREAKGLASS || "";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const PORT = Number(process.env.PORT) || 5000;

  app.use(express.json({ limit: "256kb" }));

  // In production refuse to boot without a usable operator allow-list. The
  // previous APP_PASSWORD-only mode left a single shared secret with no
  // identity or audit trail; we now require explicit per-user accounts.
  if (
    process.env.NODE_ENV === "production" &&
    OPERATOR_EMAILS.size === 0 &&
    OPERATOR_UIDS.size === 0 &&
    OWNER_EMAILS.size === 0
  ) {
    console.error(
      "FATAL: OPERATOR_EMAILS, OPERATOR_UIDS, or OWNER_EMAILS must be set in production. " +
        "Comma-separated list of Firebase Auth identities allowed to access operator endpoints. See DEPLOY.md.",
    );
    process.exit(1);
  }

  const OPERATOR_ROOM = "operators";

  // Persistent (Firestore-backed if a service account is configured, otherwise
  // local-JSON) dynamic operator allow-list. Owners can add/remove entries at
  // runtime via the Admin tab without redeploying. A short in-memory cache
  // keeps the auth hot path synchronous.
  const allowList = createAllowList(adminApp);
  // Warm the cache at boot so the first auth check after restart isn't blind.
  allowList
    .list(true)
    .then((entries) =>
      console.log(
        `[allowlist] loaded ${entries.length} dynamic operator email(s) from persistent store`,
      ),
    )
    .catch((e) => console.warn("[allowlist] initial load failed:", e?.message));

  async function isAllowedOperator(decoded: DecodedIdToken): Promise<boolean> {
    if (OPERATOR_UIDS.has(decoded.uid)) return true;
    const email = (decoded.email || "").toLowerCase();
    if (!email) return false;
    if (!decoded.email_verified) return false;
    if (OPERATOR_EMAILS.has(email)) return true;
    if (OWNER_EMAILS.has(email)) return true; // owners are implicitly operators
    // Cache-backed lookup: refreshes from Firestore / file when the 30s TTL
    // expires, so changes made on a different server instance propagate
    // within ~30s instead of being pinned to whatever was loaded at boot.
    try {
      if (await allowList.has(email)) return true;
    } catch (e: any) {
      console.warn("[allowlist] has() lookup failed, denying:", e?.message);
    }
    return false;
  }

  function isOwnerEmail(email: string | undefined): boolean {
    if (!email) return false;
    return OWNER_EMAILS.has(email.toLowerCase());
  }

  // Lightweight email validator. Sufficient for operator allow-list entries
  // since the email is also verified by Firebase Auth at sign-in time.
  const isValidEmail = (s: unknown): s is string =>
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  // Returns the resolved operator identity if the request is authorized,
  // null otherwise. Logs every grant/deny so operator activity is auditable.
  async function authorizeRequest(
    req: express.Request,
  ): Promise<{ uid: string; email?: string; method: "firebase" | "breakglass" } | null> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    if (!token) return null;

    // Break-glass path: ONLY active when the env var is set to a non-empty
    // value AND the presented token matches it exactly. Surfaced as a
    // distinct identity in audit logs.
    if (BREAK_GLASS_PASSWORD && token === BREAK_GLASS_PASSWORD) {
      console.warn(
        `[auth] BREAK-GLASS access granted to ${req.method} ${req.path} from ${req.ip}. Rotate APP_PASSWORD_BREAKGLASS afterward.`,
      );
      return { uid: "breakglass", method: "breakglass" };
    }

    try {
      const decoded = await adminAuth.verifyIdToken(token);
      if (!(await isAllowedOperator(decoded))) {
        console.warn(
          `[auth] DENY (not on operator allow-list): uid=${decoded.uid} email=${decoded.email ?? "?"} ${req.method} ${req.path}`,
        );
        return null;
      }
      console.log(
        `[auth] GRANT uid=${decoded.uid} email=${decoded.email ?? "?"} ${req.method} ${req.path}`,
      );
      return { uid: decoded.uid, email: decoded.email, method: "firebase" };
    } catch (e: any) {
      console.warn(`[auth] DENY (token verify failed): ${e?.code || e?.message} ${req.method} ${req.path}`);
      return null;
    }
  }

  const authMiddleware = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const ident = await authorizeRequest(req);
    if (!ident) {
      res.status(401).json({ error: "Unauthorized. Sign in with an operator account." });
      return;
    }
    (req as any).operator = ident;
    next();
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

  // Socket.io authentication. Connections without a valid operator token are
  // still accepted (so anonymous clients can be served the SPA via the same
  // server), but only authenticated sockets are added to the OPERATOR_ROOM
  // where sensitive diagnostic events are broadcast.
  io.use(async (socket, next) => {
    const token = (socket.handshake.auth as any)?.token
      || (socket.handshake.headers as any)?.["x-access-key"];
    socket.data.isOperator = false;
    socket.data.operatorId = null;
    if (typeof token === "string" && token.length > 0) {
      if (BREAK_GLASS_PASSWORD && token === BREAK_GLASS_PASSWORD) {
        socket.data.isOperator = true;
        socket.data.operatorId = "breakglass";
      } else {
        try {
          const decoded = await adminAuth.verifyIdToken(token);
          if (await isAllowedOperator(decoded)) {
            socket.data.isOperator = true;
            socket.data.operatorId = decoded.uid;
            socket.data.operatorEmail = decoded.email;
          }
        } catch {
          // Invalid token → anonymous socket, no error to caller.
        }
      }
    }
    next();
  });

  io.on("connection", (socket) => {
    if (socket.data.isOperator) {
      socket.join(OPERATOR_ROOM);
      console.log(
        `Operator socket connected: ${socket.id} (uid=${socket.data.operatorId} email=${socket.data.operatorEmail ?? "?"})`,
      );
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

  // ───────────── External Database (optional) ─────────────
  // Plug in any Postgres connection string (Neon / Supabase / Render / RDS / …)
  // by setting DATABASE_URL. The app boots fine without it; endpoints below
  // surface a clear "not configured" status when the env var is missing.
  if (db.isConfigured()) {
    db.migrate()
      .then(() => console.log("[db] connected — schema migrated"))
      .catch((err) => console.error("[db] migration failed:", err.message));
  } else {
    console.log("[db] DATABASE_URL not set — persistence endpoints disabled");
  }

  app.get("/api/db/status", async (_req, res) => {
    try {
      res.json(await db.status());
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // Persist a completed simulation snapshot. Auth-protected.
  app.post("/api/db/runs", authMiddleware, async (req, res) => {
    if (!db.isConfigured()) {
      return res.status(503).json({ ok: false, error: "Database not configured" });
    }
    try {
      const { final_step, final_health, agent_count, notes } = req.body ?? {};
      const r = await db.query<{ id: string; started_at: string }>(
        `INSERT INTO simulation_runs (ended_at, final_step, final_health, agent_count, notes)
         VALUES (NOW(), $1, $2, $3, $4)
         RETURNING id, started_at`,
        [
          Number.isFinite(final_step) ? Number(final_step) : null,
          Number.isFinite(final_health) ? Number(final_health) : null,
          Number.isFinite(agent_count) ? Number(agent_count) : null,
          notes && typeof notes === "object" ? JSON.stringify(notes) : null,
        ],
      );
      res.json({ ok: true, run: r.rows[0] });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get("/api/db/runs", authMiddleware, async (req, res) => {
    if (!db.isConfigured()) {
      return res.status(503).json({ ok: false, error: "Database not configured" });
    }
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const r = await db.query(
        `SELECT id, started_at, ended_at, final_step, final_health, agent_count, notes
           FROM simulation_runs
           ORDER BY started_at DESC
           LIMIT $1`,
        [limit],
      );
      res.json({ ok: true, runs: r.rows });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // Operator identity probe. The client calls this after Firebase sign-in
  // to confirm whether the signed-in user is on the operator allow-list,
  // and whether they additionally hold owner privileges (which gate the
  // Admin tab + dynamic allow-list mutation endpoints).
  app.post("/api/auth/verify", authMiddleware, (req, res) => {
    const op = (req as any).operator as { uid: string; email?: string; method: string };
    res.json({
      success: true,
      uid: op.uid,
      email: op.email ?? null,
      method: op.method,
      isOwner: isOwnerEmail(op.email),
    });
  });

  // ───────────── Admin: dynamic operator allow-list ─────────────
  // Only owners (OWNER_EMAILS env var) can enumerate / mutate the dynamic
  // allow-list or read the audit log. Owner status is sourced from env-only
  // and cannot be granted via this API — that prevents a compromised dynamic
  // entry from escalating itself.
  const ownerOnly = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const op = (req as any).operator as { uid: string; email?: string } | undefined;
    if (!op || !isOwnerEmail(op.email)) {
      res.status(403).json({ ok: false, error: "Owner access required." });
      return;
    }
    next();
  };

  app.get("/api/admin/operators", authMiddleware, ownerOnly, async (_req, res) => {
    try {
      const dynamic = await allowList.list();
      res.json({
        ok: true,
        envOperatorEmails: [...OPERATOR_EMAILS].sort(),
        envOperatorUids: [...OPERATOR_UIDS].sort(),
        ownerEmails: [...OWNER_EMAILS].sort(),
        dynamic,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.post("/api/admin/operators", authMiddleware, ownerOnly, async (req, res) => {
    try {
      const rawEmail = String(req.body?.email ?? "").trim().toLowerCase();
      const noteRaw = req.body?.note;
      const note =
        typeof noteRaw === "string" && noteRaw.trim().length > 0
          ? noteRaw.trim().slice(0, 200)
          : undefined;
      if (!isValidEmail(rawEmail)) {
        return res.status(400).json({ ok: false, error: "Invalid email address." });
      }
      if (OPERATOR_EMAILS.has(rawEmail)) {
        return res
          .status(409)
          .json({ ok: false, error: "Email is already in the env-managed operator list." });
      }
      if (OWNER_EMAILS.has(rawEmail)) {
        return res
          .status(409)
          .json({ ok: false, error: "Email is already an owner (and therefore an operator)." });
      }
      const op = (req as any).operator as { uid: string; email?: string };
      const entry = await allowList.add(rawEmail, { uid: op.uid, email: op.email }, note);
      res.json({ ok: true, entry });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.delete(
    "/api/admin/operators/:email",
    authMiddleware,
    ownerOnly,
    async (req, res) => {
      try {
        const email = String(req.params.email ?? "").trim().toLowerCase();
        if (!isValidEmail(email)) {
          return res.status(400).json({ ok: false, error: "Invalid email address." });
        }
        if (OWNER_EMAILS.has(email)) {
          return res.status(400).json({
            ok: false,
            error:
              "Owners cannot be removed via the Admin panel. Update the OWNER_EMAILS env var.",
          });
        }
        if (OPERATOR_EMAILS.has(email)) {
          return res.status(400).json({
            ok: false,
            error:
              "This email is sourced from the OPERATOR_EMAILS env var. Update the env var to remove it.",
          });
        }
        const op = (req as any).operator as { uid: string; email?: string };
        const removed = await allowList.remove(email, { uid: op.uid, email: op.email });
        if (!removed) {
          return res
            .status(404)
            .json({ ok: false, error: "Email not found in dynamic allow-list." });
        }
        res.json({ ok: true });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: e?.message });
      }
    },
  );

  app.get("/api/admin/audit", authMiddleware, ownerOnly, async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const audit = await allowList.listAudit(limit);
      res.json({ ok: true, audit });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message });
    }
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
    const op = (req as any).operator as { uid: string };
    const log = { ...req.body, serverTimestamp: new Date().toISOString(), operatorUid: op.uid };
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

  app.post("/api/sentinel/report", rateLimitReport, async (req, res) => {
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

      // Whether to treat the caller as a trusted operator or anonymous. We
      // verify the bearer token (if any) the same way as authMiddleware but
      // do NOT reject unauthenticated callers — anonymous reports just get
      // flagged as `trusted: false` and bucketed into a separate eviction
      // budget by the Sentinel store.
      const ident = await authorizeRequest(req);
      const trusted = !!ident;

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
    const envAllowList = [
      ...[...OPERATOR_EMAILS].map((e) => `email:${e}`),
      ...[...OPERATOR_UIDS].map((u) => `uid:${u}`),
      ...[...OWNER_EMAILS].map((e) => `owner:${e}`),
    ];
    console.log(
      `Operator allow-list (env): ${envAllowList.length === 0 ? "(empty — dev mode, all token-verifies denied)" : envAllowList.join(", ")}` +
        `${BREAK_GLASS_PASSWORD ? " | break-glass: ENABLED" : ""}`,
    );
    console.log(
      `Owners (can manage runtime allow-list via Admin tab): ${
        OWNER_EMAILS.size === 0 ? "(none — set OWNER_EMAILS to enable Admin tab)" : [...OWNER_EMAILS].join(", ")
      }`,
    );
    // Production guardrail: if owners can mutate the dynamic allow-list but
    // we're persisting to a local JSON file, every server replica will keep
    // its own private copy and changes will not propagate. This is fine on
    // single-instance deploys (Replit GCE / Render single-web-service) but
    // dangerous on horizontally-scaled hosts. Surface it loudly so the
    // operator notices BEFORE inviting a teammate via the Admin tab.
    if (
      process.env.NODE_ENV === "production" &&
      OWNER_EMAILS.size > 0 &&
      !process.env.FIREBASE_SERVICE_ACCOUNT
    ) {
      console.warn(
        "[allowlist] WARNING: Admin tab is enabled (OWNER_EMAILS set) but " +
          "FIREBASE_SERVICE_ACCOUNT is not — operator changes will be saved to " +
          "a local JSON file inside this server instance only. On any deployment " +
          "with more than one replica, changes made on one replica will NOT be " +
          "visible to the others. Set FIREBASE_SERVICE_ACCOUNT to use Firestore " +
          "for shared persistence. See DEPLOY.md.",
      );
    }
  });
}

startServer();
