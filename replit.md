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
- Deployment target: `vm` (Socket.IO needs persistent server).

## Auth
- API endpoints gated by `APP_PASSWORD` env (defaults to `organoid2026`).

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

