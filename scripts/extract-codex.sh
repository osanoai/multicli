#!/bin/bash
# extract-codex.sh - Extract model identifiers from the Codex repository.

# Use a unique temporary directory
TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'codex-extract')
REPO_URL="${CODEX_REPO_URL:-https://github.com/openai/codex}"
MODELS_FILE="codex-rs/core/models.json"

# Function to clean up on exit
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# 1. Shallow clone with no checkout for efficiency
if ! git clone --quiet --depth 1 --no-checkout --filter=blob:none "$REPO_URL" "$TMP_DIR" > /dev/null 2>&1; then
    echo "[]"
    exit 0
fi

cd "$TMP_DIR" || { echo "[]"; exit 0; }

# 2. Attempt to checkout the models file from main
if ! git checkout main -- "$MODELS_FILE" > /dev/null 2>&1; then
    # Fallback to master if main failed
    if ! git checkout master -- "$MODELS_FILE" > /dev/null 2>&1; then
        echo "[]"
        exit 0
    fi
fi

# 3. Extract slugs using jq and output as a JSON array to stdout
if [ -f "$MODELS_FILE" ]; then
    RESULT=$(jq -c '[.models[].slug | select(contains("oss") | not)] | unique' "$MODELS_FILE")
else
    RESULT="[]"
fi

echo "${RESULT:-[]}"
