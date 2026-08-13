#!/bin/zsh
set -e

# The companion lives in the apps/companion npm workspace; its dependencies
# are hoisted into the repo-root node_modules, so everything runs from root.
PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  print "Node.js is required. Install the current Node.js LTS release, then run this file again."
  read -r "?Press Return to close."
  exit 1
fi

if [[ ! -x node_modules/.bin/electron ]] || [[ ! -d node_modules/@jitsi/robotjs ]]; then
  print "Jarvis Companion dependencies are missing. Installing them now..."
  npm install --include=dev
fi

print "Starting Jarvis Companion..."
print "Look for the Jarvis icon in the menu bar. Keep this Terminal window open."
npm run companion
