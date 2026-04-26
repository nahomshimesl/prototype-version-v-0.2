# Threat Model

## Project Overview

This project is a single-server React + Vite frontend with an Express + Socket.IO backend for an organoid simulation and diagnostics platform. Production entry points are `server.ts` on the server and `src/main.tsx` on the client. The app uses Firebase Authentication and Firestore for user research logs, plus Google Gemini for simulation analysis and the "Stability Sentinel" diagnostic subsystem. Under the current production scope, `starter/` is a separate reference implementation and should usually be treated as dev-only unless future deployment wiring proves otherwise.

Assumptions for this threat model: production runs with `NODE_ENV=production`; TLS is handled by the platform; mockup/sandbox-only surfaces are out of scope unless they are reachable from the production app.

## Assets

- **Application secrets** — `APP_PASSWORD`, `GEMINI_API_KEY`, and any Firebase-associated configuration or service credentials. Exposure can enable unauthorized API use, billing abuse, or privileged backend actions.
- **User research data** — Firestore `researchLogs` documents tied to Firebase user IDs. These contain per-user simulation history and notes.
- **Diagnostic data** — system logs, incident reports, stack traces, runtime context, and sentinel analysis. This data can contain internal implementation details, browser metadata, and user-associated context.
- **Runtime control surfaces** — simulation endpoints, health/logging endpoints, sentinel recovery endpoints, and realtime Socket.IO broadcasts. Abuse can degrade service or manipulate operators.

## Trust Boundaries

- **Browser ↔ Express API** — every `/api/*` endpoint must treat the client as untrusted. Any auth or authorization enforced only in the UI is insufficient.
- **Browser ↔ Socket.IO server** — realtime events are broadcast from the server to connected clients. Channels carrying incidents, stack traces, or recovery hints cross a sensitive boundary.
- **Browser ↔ Firebase** — the client talks directly to Firebase Auth and Firestore. Firestore rules are the authoritative server-side control for user research logs.
- **Express ↔ Gemini API** — the server calls external AI services with a secret API key. That key must never be exposed to the browser.
- **Public ↔ privileged diagnostics/admin actions** — simulation control, telemetry mutation, incident analysis, and recovery actions are privileged operations and must not rely on publicly shipped shared secrets.
- **Dev/reference ↔ production** — `starter/`, local-only state files, and reference deployment artifacts should be ignored unless production wiring makes them reachable.

## Scan Anchors

- **Production entry points:** `server.ts`, `src/main.tsx`, `src/App.tsx`
- **Highest-risk code areas:** `server.ts`, `services/sentinel.ts`, `src/services/SentinelClient.ts`, `src/services/HealthEngine.ts`, `src/services/PredictionService.ts`, `src/firebase.ts`, `firestore.rules`
- **Public surfaces:** unauthenticated `GET /api/system/health`, `GET /api/system/logs`, `POST /api/sentinel/report`, `GET /api/sentinel/*`, Socket.IO connection setup in `server.ts`
- **Authenticated/privileged surfaces:** `/api/auth/verify`, `/api/simulate`, `POST /api/system/*`, sentinel analyze/recover/acknowledge endpoints
- **Usually dev-only:** `starter/`, `.local/`, unused example deployment files unless confirmed active in production

## Threat Categories

### Spoofing

The app currently uses a shared bearer token model for backend-protected routes instead of per-user server sessions. Any privileged backend route must require a secret that is not embedded in the browser, and privileged actions must not be authorized solely by possession of a frontend-shipped static token.

### Tampering

Clients can submit simulation inputs, telemetry, and incident reports. The server must validate and constrain these payloads, and privileged mutation endpoints must not allow arbitrary callers to alter health state, logs, or recovery actions. Recovery channels that broadcast actions to connected clients must only be invokable by authorized operators.

### Information Disclosure

The diagnostic subsystem handles stack traces, runtime messages, browser context, and potentially user-linked metadata. Public APIs and realtime broadcasts must not expose incident details, system logs, user identifiers, or internal error context to unauthenticated users. Secrets such as `GEMINI_API_KEY` and backend access keys must never be included in client bundles.

### Denial of Service

Public reporting and telemetry endpoints can be abused to create large numbers of incidents, inflate memory/disk usage, or trigger repeated expensive analysis and broadcast activity. Public endpoints must be bounded with strict payload limits, rate limiting, and careful retention rules.

### Elevation of Privilege

Any route that changes system state, writes logs, performs analysis, or triggers recovery actions is effectively an operator surface. The project must enforce server-side authorization for those operations and ensure that secrets used to reach them are stored only on the server, not in shipped JavaScript or visible UI defaults.
