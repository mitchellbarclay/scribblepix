#!/bin/sh
# Copies the canonical Tiny Draw web app into the iOS bundle's web/ folder.
#
# The web app at the repo root stays the single source of truth. This produces
# the offline copy that ships inside the native iPad app. It runs automatically
# as the first build phase in Xcode, so you never hand-edit ios/TinyDraw/web/.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"   # …/ios
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"     # repo root
DEST="$SCRIPT_DIR/TinyDraw/web"

# Everything the web app loads locally. CDN deps (fonts, three.js, rive) are
# fetched at runtime over https and are NOT vendored here yet — see ios/README.md.
ASSETS="index.html manifest.json version.json icons app-icons src"

rm -rf "$DEST"
mkdir -p "$DEST"

for item in $ASSETS; do
  if [ -e "$REPO_ROOT/$item" ]; then
    cp -R "$REPO_ROOT/$item" "$DEST/"
  else
    echo "warning: $item not found at repo root, skipping" >&2
  fi
done

echo "Synced web assets -> $DEST"
