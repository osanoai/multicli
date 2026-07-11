#!/bin/bash
# extract-codex.sh - Extract model identifiers from the Codex repository.

# Use a unique temporary directory
TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'codex-extract')
REPO_URL="${CODEX_REPO_URL:-https://github.com/openai/codex}"
# Codex moved the bundled model metadata from core/ to models-manager/.
# Try the new location first, then fall back to the old one for older refs.
MODELS_FILES=(
    "codex-rs/models-manager/models.json"
    "codex-rs/core/models.json"
)

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

# 2. Attempt to checkout the models file: try each branch (main, master)
#    against each candidate path, and use the first one that exists.
MODELS_FILE=""
for branch in main master; do
    for candidate in "${MODELS_FILES[@]}"; do
        if git checkout "$branch" -- "$candidate" > /dev/null 2>&1; then
            MODELS_FILE="$candidate"
            break 2
        fi
    done
done

if [ -z "$MODELS_FILE" ]; then
    echo "[]"
    exit 0
fi

# 3. Extract gpt- slugs using jq and output as a JSON array to stdout
if [ -f "$MODELS_FILE" ]; then
    RESULT=$(jq -c '[.models[].slug | select(startswith("gpt-")) | select(contains("oss") | not)] | unique' "$MODELS_FILE")
else
    RESULT="[]"
fi

echo "${RESULT:-[]}"
