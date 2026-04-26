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
3. In **Environment Variables**, set `APP_PASSWORD` to a long random string of your choice (see security note below). `GEMINI_API_KEY` is genuinely optional — skip it unless you want AI analysis.
4. Click **Create Web Service**.
5. Wait ~3–5 min for the first build. Render shows a live `https://boss-organoid.onrender.com`-style URL when it's ready.

That's it. Every subsequent `git push origin main` triggers an automatic redeploy.

## Environment variables

> ⚠️ **Security note for public deploys:** the codebase has a built-in fallback password (`organoid2026`) so the app still runs without `APP_PASSWORD` set — but that string is in the public source code. On a public URL like `*.onrender.com`, anyone who finds the repo can become an operator. **Always set `APP_PASSWORD` to a fresh random value when deploying anywhere reachable from the internet.**

| Variable | What it does | If unset |
|---|---|---|
| `APP_PASSWORD` | Sets the operator-mode access key for the diagnostic dashboard, system logs endpoints, and Sentinel mutation endpoints. | Falls back to the public default `organoid2026` — **insecure for public deploys**. Always set this on any internet-reachable host. |
| `GEMINI_API_KEY` | Enables AI-powered root-cause analysis in the Stability Sentinel. | The Sentinel uses its built-in heuristic analyzer instead. Every other feature works the same. Safe to leave unset. |

To set them on Render: dashboard → your service → **Environment** tab → **Add Environment Variable**.

## Free-tier note
Render's free plan sleeps the service after ~15 minutes of inactivity and cold-starts in ~30 seconds on the next request. The $7/mo "Starter" plan removes the sleep behavior. Your simulation state is **in-memory only**, so a sleep/restart will reset session-bound data — keep this in mind for live demos.

## Other hosts (Railway / Fly.io / Heroku)
Both `render.yaml` and `Procfile` are in the repo. The `Procfile` runs `npm run build && npm run start` so the bundle gets produced on hosts that don't have a separate build step.
- **Railway:** Connect repo → auto-detects Node and reads `Procfile`.
- **Fly.io:** Run `fly launch` in a local clone — it generates a `fly.toml` from `package.json` and the `Procfile`.
- **Heroku:** Connect repo → reads `Procfile` automatically.

Same env-var rules apply on every host — the security note above is non-negotiable for any public URL.
