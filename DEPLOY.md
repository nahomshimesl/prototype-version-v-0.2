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
3. **Environment Variables** — `APP_PASSWORD` is **required** in production (the server refuses to boot without it). Set it to a long random string here. `GEMINI_API_KEY` is optional and can be left unset. See the table below for details.
4. Click **Create Web Service**.
5. Wait ~3–5 min for the first build. Render shows a live `https://boss-organoid.onrender.com`-style URL when it's ready.

That's it. Every subsequent `git push origin main` triggers an automatic redeploy.

## Environment variables

`APP_PASSWORD` is **required** in production (`NODE_ENV=production`); the server aborts boot with a one-line error if it's missing. `GEMINI_API_KEY` is optional.

| Variable | What it does | If unset |
|---|---|---|
| `APP_PASSWORD` | Sets the operator-mode access key for the diagnostic dashboard, system logs endpoints, and Sentinel mutation endpoints. | **Production:** server refuses to start. **Dev (`npm run dev`):** falls back to the built-in default `organoid2026` so local work needs no setup. |
| `GEMINI_API_KEY` | Enables AI-powered root-cause analysis in the Stability Sentinel. | The Sentinel uses its built-in heuristic analyzer instead. Every other feature works the same. Safe to leave unset. |

> ⚠️ **Why this is enforced:** the dev fallback (`organoid2026`) is in the public source code. On a public URL like `*.onrender.com`, anyone who finds the repo could become an operator. The server now refuses to boot in production unless `APP_PASSWORD` is set to a fresh value — set it to a long random string in your host's environment tab.

To set them on Render: dashboard → your service → **Environment** tab → **Add Environment Variable**.

## Free-tier note
Render's free plan sleeps the service after ~15 minutes of inactivity and cold-starts in ~30 seconds on the next request. The $7/mo "Starter" plan removes the sleep behavior. Your simulation state is **in-memory only**, so a sleep/restart will reset session-bound data — keep this in mind for live demos.

## Other hosts (Railway / Fly.io / Heroku)
Both `render.yaml` and `Procfile` are in the repo. The `Procfile` is `web: npm run start`, which assumes the host runs `npm run build` during the build phase (the standard pattern for Node apps).
- **Railway:** Connect repo → auto-detects Node and runs `npm run build` automatically before `npm run start` from the `Procfile`.
- **Fly.io:** Run `fly launch` in a local clone — it generates a `fly.toml` and a Dockerfile that runs `npm run build` during the image build.
- **Heroku:** Connect repo → standard Node buildpack runs `npm run build` automatically; `Procfile` provides the start command.

If your host does **not** run `npm run build` automatically, either configure a build step in its dashboard or change `Procfile` locally to `web: npm run build && npm run start`.

Same env-var rules apply on every host — the security note above is the same for any public URL.
