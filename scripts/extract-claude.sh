#!/bin/bash
exec 2>/dev/null

# Use a unique temporary directory
TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'claude-extract')

# Function to clean up on exit
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$TMP_DIR" || { echo '{}'; exit 0; }

TARBALL=$(npm pack @anthropic-ai/claude-code@latest) || { echo '{}'; exit 0; }
tar -xzf "$TARBALL" || { echo '{}'; exit 0; }

RESULT=$(grep 'OPUS_ID.*OPUS_NAME.*SONNET_ID.*SONNET_NAME' ./package/cli.js | \
  grep -o '{OPUS_ID:"[^"]*",OPUS_NAME:"[^"]*",SONNET_ID:"[^"]*",SONNET_NAME:"[^"]*"[^}]*}' | \
  sed 's/\([A-Z_]*\):/"\1":/g' | \
  jq -c '[to_entries[] | select(.key | endswith("_ID")) | .value] | unique') || { echo '[]'; exit 0; }

echo "${RESULT:-[]}"
