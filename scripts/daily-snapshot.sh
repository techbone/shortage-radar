#!/bin/bash
# Fetch the FDA shortage feed and commit the snapshot if it is new.
# Run by a launchd agent twice a day during the build (see docs/build-log.md);
# safe to run by hand: `bash scripts/daily-snapshot.sh`.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[INFO] $(date -u +%Y-%m-%dT%H:%M:%SZ) daily snapshot"
npm run -s snapshot

# Keep Zetaris's cached copy of the feed fresh too (skipped quietly if Zetaris is not running).
npm run -s zetaris:refresh || echo "[WARN] zetaris refresh did not run"

new=$(git ls-files --others --exclude-standard data/snapshots)
if [ -z "$new" ]; then
  echo "[INFO] no new snapshot"
  exit 0
fi
git add -- $new
git commit -q -m "chore: fda shortage snapshot $(basename $new | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')" --only -- $new
echo "[INFO] committed $new"
