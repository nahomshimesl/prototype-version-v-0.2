#!/bin/bash
set -e
# Post-merge setup: keep node_modules in sync with package-lock.json.
# Idempotent and non-interactive.
npm install --no-audit --no-fund --silent
