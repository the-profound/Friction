#!/bin/bash
set -e
pnpm install --frozen-lockfile
python3 scripts/db-push-auto.py lib/db
