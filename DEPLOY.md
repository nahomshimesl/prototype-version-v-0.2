# Deploying BOSS without Replit

If Replit's deploy pipeline is misbehaving (the recurring `ENOENT: .replit` error), you can host this app on any service that runs a long-lived Node.js process. **Render** is recommended because its free tier supports the Socket.IO websockets this app needs and requires no terminal commands.

## Prerequisites
- Repo on GitHub: https://github.com/nahomshimesl/nahom-dotcom (already done ✓)
- Render account (free): https://render.com — sign in with GitHub

## Deploy on Render — 5 steps

1. Go to **https://dashboard.render.com/select-repo?type=web** and pick `nahomshimesl/nahom-dotcom`.
2. Render reads `render.yaml` from the repo and pre-fills everything. Confirm:
   - **Runtime:** Node
   - **Build:** `npm install && npm run build`
   - **Start:** `npm run start`
   - **Plan:** Free
3. **Environment Variables** — `OPERATOR_EMAILS` is **required** in production (the server refuses to boot without it). Set it to a comma-separated list of the Google account emails that should have operator access. `GEMINI_API_KEY` is optional and can be left unset. See the table below for details.
4. Click **Create Web Service**.
5. Wait ~3–5 min for the first build. Render shows a live `https://boss-organoid.onrender.com`-style URL when it's ready.

That's it. Every subsequent `git push origin main` triggers an automatic redeploy.

## Operator authentication (per-user)

Operators sign in to the protected endpoints with **their own Google account** via Firebase Auth — there is no shared password. The server verifies each request's Firebase ID token with the Firebase Admin SDK and checks the resolved identity against an explicit allow-list.

### Required configuration

| Variable | What it does | If unset |
|---|---|---|
| `OPERATOR_EMAILS` | Comma-separated list of Google account emails allowed to act as operators (e.g. `alice@example.com,bob@example.com`). Emails must be verified by Google. | **Production:** server refuses to start. **Dev (`npm run dev`):** allowed; all token verifies are denied (so only the optional break-glass below can grant access). |
| `OPERATOR_UIDS` | Optional comma-separated list of Firebase UIDs allowed as operators. Useful when an account does not expose a stable email (service accounts, anonymous-then-linked, etc.). At least one of `OPERATOR_EMAILS` / `OPERATOR_UIDS` must be non-empty in production. | Treated as empty. |

### Optional configuration

| Variable | What it does | If unset |
|---|---|---|
| `APP_PASSWORD_BREAKGLASS` | Optional shared bearer token kept **only as a documented break-glass fallback** for when Firebase Auth itself is unavailable. When set, presenting it as `Authorization: Bearer <value>` grants operator access and is logged as `breakglass` in the audit trail. | Break-glass path is fully closed — no shared password works. This is the recommended default. |
| `FIREBASE_SERVICE_ACCOUNT` | Single-line JSON of a Firebase service account. Token verification works **without** this (the Admin SDK fetches Google's public keys directly), so this is only needed if you want to call other Admin SDK methods. | Admin SDK is initialized with project ID only, which is sufficient for ID-token verification. |
| `GEMINI_API_KEY` | Enables AI-powered root-cause analysis in the Stability Sentinel. | The Sentinel uses its built-in heuristic analyzer instead. Every other feature works the same. |

### How operators sign in

1. Operator opens the deployed URL and clicks the **Full-Stack Prototype** tab.
2. They click **Sign in with Google** — Firebase Auth handles the OAuth popup.
3. The client sends their Firebase ID token to `/api/auth/verify`. The server verifies the token and checks the email against `OPERATOR_EMAILS`.
4. If allowed, they are upgraded to operator status (real-time Sentinel events, mutate endpoints unlocked). If denied, the UI shows "Your account is not on the operator allow-list" and offers a **Sign out** button so they can try a different account.

### Adding / removing an operator

Two paths:

1. **Env var (`OPERATOR_EMAILS`)** — durable, requires a redeploy:
   - **Add:** append the email to `OPERATOR_EMAILS` in the host's environment tab and redeploy. The new operator just needs to sign in with that Google account.
   - **Remove:** delete the email from `OPERATOR_EMAILS` and redeploy. The next request from that user will get a 401 — no password rotation needed, no other operators are affected.
2. **In-app Admin tab (no redeploy)** — for owners only:
   - Set `OWNER_EMAILS=alice@example.com,bob@example.com` (comma-separated). Owners are implicitly operators **and** see an extra **Admin** tab in the sidebar.
   - From the Admin tab, owners can add or remove operator emails on the fly. Changes propagate within ~30s on this server, and within ~30s on every other server replica that uses the same persistent store.
   - **Persistence:** the dynamic allow-list lives in **Firestore** when `FIREBASE_SERVICE_ACCOUNT` is set (recommended for any multi-replica deploy). Otherwise it falls back to a local JSON file inside the server (`.local/operator-allow-list.json`) — fine for single-instance deploys (default Render web service / Replit GCE), but on horizontally scaled hosts each replica would keep its own private list. The server prints a loud `[allowlist] WARNING` at boot if you enable the Admin tab in production without Firestore.
   - **Owner status is env-only by design.** The Admin tab cannot create new owners — that would be an escalation path. To rotate owners, edit `OWNER_EMAILS` and redeploy. Make sure you don't remove your own address before saving — there is no in-app recovery once you lose owner status.

### Audit trail

Every grant and deny is logged to stdout with the request method, path, UID, and email (or `breakglass` for the fallback path):

```
[auth] GRANT uid=abc123 email=alice@example.com POST /api/sentinel/incidents/x/recover
[auth] DENY (not on operator allow-list): uid=def456 email=eve@example.com POST /api/system/logs
[auth] BREAK-GLASS access granted to POST /api/auth/verify from 1.2.3.4. Rotate APP_PASSWORD_BREAKGLASS afterward.
```

To set environment variables on Render: dashboard → your service → **Environment** tab → **Add Environment Variable**.

> ⚠️ **Why per-user instead of a shared password:** the previous `APP_PASSWORD` model meant anyone with the password was indistinguishable from anyone else, there was no audit trail, and revoking access for one person required rotating the password for everyone. Per-user Firebase Auth gives real identity, instant revocation by editing the allow-list, and a per-request audit trail.

## Free-tier note
Render's free plan sleeps the service after ~15 minutes of inactivity and cold-starts in ~30 seconds on the next request. The $7/mo "Starter" plan removes the sleep behavior. Your simulation state is **in-memory only**, so a sleep/restart will reset session-bound data — keep this in mind for live demos.

## Other hosts (Railway / Fly.io / Heroku)
Both `render.yaml` and `Procfile` are in the repo. The `Procfile` is `web: npm run start`, which assumes the host runs `npm run build` during the build phase (the standard pattern for Node apps).
- **Railway:** Connect repo → auto-detects Node and runs `npm run build` automatically before `npm run start` from the `Procfile`.
- **Fly.io:** Run `fly launch` in a local clone — it generates a `fly.toml` and a Dockerfile that runs `npm run build` during the image build.
- **Heroku:** Connect repo → standard Node buildpack runs `npm run build` automatically; `Procfile` provides the start command.

Same env-var rules apply on every host — the operator allow-list is required on any public URL.
