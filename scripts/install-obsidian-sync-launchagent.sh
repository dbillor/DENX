#!/bin/zsh
set -euo pipefail

PLIST_SOURCE="/Users/dbillorgmail.com/Documents/personal operating system/launchd/com.dbillor.voice-kb.obsidian-headless-sync.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/com.dbillor.voice-kb.obsidian-headless-sync.plist"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "/Users/dbillorgmail.com/Documents/personal operating system/logs"

cp "$PLIST_SOURCE" "$PLIST_TARGET"
launchctl unload "$PLIST_TARGET" >/dev/null 2>&1 || true
launchctl load "$PLIST_TARGET"

echo "Installed and loaded: $PLIST_TARGET"
