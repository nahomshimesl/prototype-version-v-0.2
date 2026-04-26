#!/bin/bash
set -e

# Post-merge setup for BOSS (Bio-Organoid Simulation System).
# Runs after a task is merged into main.
# Idempotent and non-interactive (stdin is closed by the runner).

# Sync npm dependencies to whatever the merged package-lock.json declares.
# `npm ci` is faster and stricter than `npm install` when the lockfile is
# present and authoritative, which it is for this repo.
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund --prefer-offline
else
  npm install --no-audit --no-fund
fi

echo "post-merge setup complete"
