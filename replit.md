# Organoid Simulation App

React + Vite frontend with an Express + Socket.IO backend (single server).

## Stack
- Node.js 20, TypeScript
- Vite 6 (middleware-mode, mounted on Express)
- Express 4 + Socket.IO 4
- Firebase, Recharts, D3, Tailwind v4, Motion

## Dev
- Workflow `Server` runs `npm run dev` (`tsx server.ts`), serving on `0.0.0.0:5000`.
- Vite is configured with `allowedHosts: true` for the Replit iframe proxy.

## Build / Deploy
- Build: `npm run build` (vite build + esbuild bundles `server.ts` to `dist/server.cjs`)
- Start: `npm run start` (`node dist/server.cjs`)
- Replit deployment target: `gce` (Socket.IO needs persistent server). When Replit's deploy pipeline misbehaves, fall back to Render via `render.yaml` (or any host that reads `Procfile`). See `DEPLOY.md` for the 5-step Render walkthrough.

## Auth
- **Per-user Firebase Auth.** Operators sign in with their own Google account. The server (`server.ts`) uses `firebase-admin` to verify each request's ID token (`Authorization: Bearer <id_token>`) and checks the resolved identity against an explicit allow-list set via the `OPERATOR_EMAILS` (and/or `OPERATOR_UIDS`) env vars **plus** the dynamic allow-list managed at runtime via the in-app Admin tab. Every grant/deny is logged with the UID + email so operator activity is auditable.
- In production (`NODE_ENV=production`) the server refuses to boot if `OPERATOR_EMAILS`, `OPERATOR_UIDS`, AND `OWNER_EMAILS` are all empty. In dev the server still starts; without the allow-list every Firebase token verify is denied, so the only way to call operator endpoints in dev is to add yourself to one of those lists (e.g. via `.env`) or set the optional `APP_PASSWORD_BREAKGLASS` shared token.
- `APP_PASSWORD_BREAKGLASS` is the documented break-glass fallback — kept off by default (no implicit value), only honored when the env var is non-empty, and surfaced as a distinct `breakglass` identity in the audit log. The previous shared `APP_PASSWORD` flow has been removed.
- Client wiring: `src/services/HealthEngine.ts` and `src/services/SentinelClient.ts` accept a token-provider callback and skip the call when no operator is signed in. `src/App.tsx` wires this to `auth.currentUser.getIdToken()` and re-handshakes the Socket.IO connection on auth-state changes so operator-room membership tracks the current user. See `DEPLOY.md` for full setup + how to add/remove operators.

## Stability Sentinel (reliability subsystem)

A self-diagnosing reliability layer separate from the simulation-domain HealthEngine.

- **Server**: `services/sentinel.ts` — fingerprint-based incident store (persisted to `.local/sentinel-store.json`), runtime anomaly detection (memory spikes, event-loop blocks, error-rate, recurring errors), AI root-cause analysis via Gemini with heuristic fallback, and a registry of approval-gated recovery actions (`acknowledge`, `resolve`, `retry`, `reset-client-state`, `gc-hint`). RISKY actions are blocked from auto-execution by design.
- **REST**: `POST /api/sentinel/report` (unauthenticated, so client errors during auth failure still get captured), `GET /api/sentinel/{incidents,anomalies,stats,recovery-actions}`, `POST /api/sentinel/incidents/:id/{analyze,recover,acknowledge}` (auth required).
- **Realtime**: emits `sentinel:incident`, `sentinel:anomaly`, `sentinel:analysis`, `sentinel:resolved`, `sentinel:retry-hint`, `sentinel:reset-state-hint` over Socket.IO.
- **Client**: `src/services/SentinelClient.ts` installs `window.onerror` and `unhandledrejection` capture, maintains a rolling action history for diagnostic context, and exposes hooks for retry/reset events.
- **UI**: `src/components/StabilitySentinel.tsx` — dashboard tab in the main app showing live stats, anomalies, incident list, AI analysis with ranked fix suggestions (confidence + safety badges), and approval-gated recovery buttons.
- **Integration**: `src/components/ErrorBoundary.tsx` reports React errors to the Sentinel as well as the HealthEngine.

To enable AI root-cause analysis, set `GEMINI_API_KEY` in environment. Without it, the Sentinel runs heuristic-only diagnoses.

## About tab (`src/components/AboutPanel.tsx`)
- New default landing tab explaining what BOSS does, with the AI failure-prediction loop as the headline.
- Sections: hero, feature cards, 4-step prediction workflow with concrete edit→outcome examples, inline SVG architecture diagram, module guide (jump-to-tab buttons), quick-start, citation.
- Exports `ActiveTab` union type, used by `App.tsx` for `useState<ActiveTab>` and the `onJump` callback (no `as any`).
- App.tsx adds (a) ResizeObserver on simulation container and (b) a `useEffect([activeTab])` that re-measures at 60ms and 250ms when entering SIMULATION, so the visualizer fills the container correctly when switched to from another tab.

## Boot screen (`src/components/SystemBoot.tsx` + `src/main.tsx`)
- Industrial / university-research-lab aesthetic: slate/amber, serif + mono, Provenance/Reproducibility/Citation panels, kernel init log with addr/module/event/ms/stat columns, est. remaining countdown.
- 26-step boot, total ~120 s. Long scientific steps (data load bytes, regression suite 512 cases, Lancaster calibration RMSE, JIT iterations, KD-tree, SHA-256) tick visibly.
- Authored as: *Project lead: Nahom Berhanu · Rockville High School*; same as citation author.
- StrictMode-safe (timers + intervals tracked in refs, all cleared in `cancelAll`).
- `?skipBoot=1` URL param OR `sessionStorage.boss_booted === '1'` skips the boot. The flag is set automatically on first completion so refreshes within the same session don't replay it.

## Recent fixes
- Cleaned 5 pre-existing TS errors (StabilitySentinel React.ReactNode → ReactNode; Visualizer spread types).
- Removed duplicate `TelemetryEvent` import in `src/App.tsx`.
- Server port changed from 3000 → 5000 (with `PORT` env override).
- Triggered workspace re-sync to resolve deploy-side stale snapshot.


## Per-agent micro-policies (additive — Apr 2026)
Each `AgentState` now carries a `policy` field of type `AgentPolicy`:
- `REACTIVE` — original default behavior (unchanged math)
- `COOPERATIVE` — emits emergency alerts at slightly lower energy threshold
- `ECONOMIST` — hoards energy, suppresses alerts when energy < 25
- `EXPLORER` — interaction radius × 1.2
- `DEFENDER` — emits emergency alerts at higher health threshold (40 vs 30)

Default policy is assigned per organ type in `pickPolicyForType()` in `src/engine/SimulationLoop.ts` (e.g., `IMMUNE_SENTINEL` → mostly `DEFENDER`). Policy is preserved across rebirth (re-rolled for the new organ type) and added to `handleAddAgent` in `App.tsx`. `AGENT_POLICY_INFO` in `src/types/simulation.ts` carries the human-readable label/description for UI use.

## Local collapse forecaster (additive — Apr 2026)
Continuous, deterministic, in-browser early-warning system that complements the on-demand Gemini AI analysis.
- **Service**: `src/services/CollapseForecaster.ts` — pure function `forecastCollapse(metrics, currentStep)`. Uses three established critical-slowing-down indicators: trend slope, variance, and lag-1 autocorrelation. Returns `CollapseForecast { collapseRisk 0-100, etaSteps, trendSlope, variance, autocorrelation, warnings[] }`.
- **Panel**: `src/components/CollapseForecast.tsx` — renders risk %, ETA, slope, indicators, and human-readable warnings; color-codes by severity.
- **Wiring**: a single `useEffect` in `App.tsx` re-runs the forecaster whenever `metrics.step` advances. Panel renders inside the HEALTH tab (above the existing `HealthDashboard`).
- No new dependencies, no API calls — runs in pure JS every tick.


## External Postgres (additive — Apr 2026)
Optional persistence layer. Plug in any Postgres connection string by setting `DATABASE_URL` (also accepts `POSTGRES_URL` / `PG_CONNECTION_STRING`).

- **Service**: `services/db.ts` — lazy `Pool` (max 5 conns, 5 s connect timeout, auto-SSL when remote/prod). Exposes `isConfigured()`, `getPool()`, `migrate()`, `status()`, `query()`, `shutdown()`. Migration is idempotent (`CREATE TABLE IF NOT EXISTS`) and runs once on first request.
- **Schema** (auto-created on boot if `DATABASE_URL` set):
  - `simulation_runs (id, started_at, ended_at, final_step, final_health, agent_count, notes JSONB)`
  - `research_logs (id, run_id → simulation_runs, ts, severity, message)`
- **Endpoints** (all on `server.ts`):
  - `GET  /api/db/status` — public; returns `{configured, connected, migrated, serverVersion, databaseSizeBytes, databaseSizePretty}`
  - `POST /api/db/runs` — auth-protected; persists a finished simulation snapshot
  - `GET  /api/db/runs?limit=N` — auth-protected; lists most-recent runs
- **Behavior without `DATABASE_URL`**: app boots normally, persistence endpoints return `503 { ok:false, error: "Database not configured" }`. Status endpoint returns `{configured:false}`.
- **For ~10 GB capacity**: Neon Scale plan, Supabase Pro (8 GB included + add-on), Render Postgres Pro. Connection string format works identically — paste it into the `DATABASE_URL` env var on Render (or `.env` locally).

## Mobile responsiveness (additive — Apr 2026)
- `App.tsx`: vertical sidebar hidden below `md` (top tab nav covers same routes); header stacks (logo + title above nav); Researcher name + System Entropy badge hidden below `lg`; bottom stats grid `2 cols → 4 cols` at `md`; sim tab padding `p-4 → p-8`; visualizer min-height `320px → 450px`.
- `SystemBoot.tsx`: meta panels (Provenance / Reproducibility / Citation) hidden below `md` so kernel log + progress + skip button fit one mobile viewport; header stacks; footer wraps; skip button full-width on phone.
- `index.css`: added `.no-scrollbar` utility (was referenced in two places but undefined).
- `main.tsx`: added `?showBoot=1` URL param to force-show the boot screen (clears `boss_booted` sessionStorage) — useful for verifying mobile layout without a fresh tab.

## Admin tab — runtime operator allow-list (additive — Apr 2026)
Owners can add/remove operator emails at runtime without redeploying. Adds a small `Admin` tab in the sidebar + top nav (only rendered when the signed-in user's email is in `OWNER_EMAILS`).

- **Server (`server.ts`)**:
  - New env var `OWNER_EMAILS` (comma-separated). Owners are implicitly operators AND can call admin endpoints.
  - `/api/auth/verify` now also returns `{ isOwner }`.
  - Endpoints (all `authMiddleware` + owner check): `GET /api/admin/operators`, `POST /api/admin/operators` (`{email, note?}`), `DELETE /api/admin/operators/:email`, `GET /api/admin/audit?limit=N`.
  - `isAllowedOperator` now ORs the env lists with the dynamic Firestore-backed allow-list (read through a 30s in-memory cache; cache primed at boot, invalidated/written-through on mutation).
  - Production boot guard now also accepts `OWNER_EMAILS` as a sufficient identity list.
- **Persistence (`services/operatorAllowList.ts`)**: tries Firestore Admin SDK when `FIREBASE_SERVICE_ACCOUNT` is set, otherwise writes to `.local/operator-allow-list.json` and `.local/operator-access-audit.jsonl`. Writes are serialized via a write queue. Audit entries (`{ts, action, targetEmail, actorEmail, actorUid}`) are appended on every ADD/REMOVE.
- **Firestore rules** (`firestore.rules`): `operatorAllowList` and `operatorAccessAudit` collections are denied to all clients — only the server (Admin SDK) writes them, which prevents an authenticated operator from escalating their own privileges via direct Firestore writes.
- **Client (`src/components/AdminPanel.tsx`)**: add-operator form with email + optional note, table of dynamic operators with Remove buttons, read-only display of env-managed operators / owners, and a paginated audit log table. Owner-status check is server-driven (App.tsx fetches `/api/auth/verify` on every auth-state change and toggles tab visibility).
- **Why owner status is env-only**: a runtime-mutable owner list would create an escalation path — anyone who could write to the dynamic allow-list could promote themselves to owner. Keeping owners in env vars only means the deployer is the root of trust.
