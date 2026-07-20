#!/bin/bash
# run_pipeline.sh — full FPL Analyser data pipeline, fail-fast, logged.
#
# Runs the chain in dependency order. Any script exiting non-zero (including
# the GATE FAIL checks inside them) aborts the run BEFORE anything is
# published, so a broken run never reaches the site.
#
# Usage:
#   ./automation/run_pipeline.sh              # full run incl. data pulls
#   ./automation/run_pipeline.sh --no-pull    # skip network pulls (reprocess only)
#   ./automation/run_pipeline.sh --no-push    # everything except git commit/push
#
# Configure via environment (or edit the defaults here):
#   FPL_REPO_DIR   repo checkout           (default: ~/Desktop/fpl-analyser)
#   FPL_DATA_DIR   pipeline data folder    (default: the Google Drive folder)

set -euo pipefail

REPO_DIR="${FPL_REPO_DIR:-$HOME/Desktop/fpl-analyser}"
LOG_DIR="$REPO_DIR/automation/logs"
LOG_FILE="$LOG_DIR/pipeline_$(date +%Y%m%d_%H%M%S).log"
PYTHON="${FPL_PYTHON:-python3}"

DO_PULL=1
DO_PUSH=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --no-push) DO_PUSH=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$LOG_DIR"
exec > >(tee "$LOG_FILE") 2>&1

cd "$REPO_DIR"
echo "══ FPL pipeline run $(date) ══"
echo "repo: $REPO_DIR"
echo "data: ${FPL_DATA_DIR:-<script defaults>}"

run_step() {
  echo ""
  echo "── $1 ──────────────────────────────────────────"
  local start=$SECONDS
  $PYTHON "$1"
  echo "── $1 done in $((SECONDS - start))s"
}

if [ "$DO_PULL" -eq 1 ]; then
  run_step pull_understat_data.py
  run_step pull_pl_stats.py
fi

run_step enrich_player_gw.py
run_step rolling_calculations.py
# advanced_metrics runs BEFORE rating: the rating's risk factor consumes its
# Sortino (advanced_metrics depends only on the GW data, not on ratings).
run_step advanced_metrics.py
run_step fpl_analyser_rating.py
run_step persona_assignment.py
run_step scouting_percentiles.py
run_step build_site_data.py

if [ "$DO_PUSH" -eq 1 ]; then
  echo ""
  echo "── publishing ──────────────────────────────────"
  git add -A
  if git diff --cached --quiet; then
    echo "no data changes — nothing to publish"
  else
    git commit -m "Data update $(date +%Y-%m-%d)"
    git push origin main
    echo "published to main"
  fi
fi

echo ""
echo "══ pipeline complete $(date) ══"

# keep the last 30 logs
ls -t "$LOG_DIR"/pipeline_*.log 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
