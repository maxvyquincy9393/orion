#!/bin/bash
# autopush.sh
#
# Auto git commit and push on file change.
# Shell alternative to autopush.py.
# Part of Orion — Persistent AI Companion System.
#
# Usage:
#   chmod +x scripts/autopush.sh
#   ./scripts/autopush.sh

WATCH_DIR="${1:-.}"
INTERVAL="${2:-30}"

echo "Orion AutoPush — Watching '$WATCH_DIR' every ${INTERVAL}s"
echo "Press Ctrl+C to stop."

while true; do
    # Check for changes
    if [[ -n $(git status --porcelain) ]]; then
        TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
        CHANGED=$(git status --short | head -5)
        
        git add .
        git commit -m "wip(auto): auto-push at $TIMESTAMP"
        git push origin main
        
        echo "[$TIMESTAMP] Pushed changes:"
        echo "$CHANGED"
    fi
    
    sleep "$INTERVAL"
done
