#!/bin/bash
# extract-gemini.sh
# Replicates the "I'm offline" model discovery logic for Gemini CLI.
# Programmatically determines the version of @google/gemini-cli on npm and
# fetches the model definitions from the corresponding Git tag.

# Use a unique temporary directory to avoid conflicts
TMP_ROOT=$(mktemp -d)
TMP_DIR="$TMP_ROOT/gemini-cli"
REPO_URL="https://github.com/google-gemini/gemini-cli.git"
TARGET_FILE="packages/core/src/config/models.ts"

# Function to clean up on exit
cleanup() {
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

# 1. Determine the target version/tag from npm
NPM_VERSION=$(npm view @google/gemini-cli version 2>/dev/null)
TARGET_REF="main"

if [ -n "$NPM_VERSION" ]; then
    # Tags follow the pattern vX.Y.Z
    POSSIBLE_TAG="v$NPM_VERSION"
    
    # Verify the tag exists without fully cloning
    if git ls-remote --tags --exit-code "$REPO_URL" "$POSSIBLE_TAG" > /dev/null 2>&1; then
        TARGET_REF="$POSSIBLE_TAG"
    fi
fi

# 2. Clone the specific target ref (branch or tag)
if ! git clone --quiet --depth 1 --branch "$TARGET_REF" --filter=blob:none --no-checkout "$REPO_URL" "$TMP_DIR" >/dev/null 2>&1; then
    TARGET_REF="main"
    if ! git clone --quiet --depth 1 --branch "$TARGET_REF" --filter=blob:none --no-checkout "$REPO_URL" "$TMP_DIR" >/dev/null 2>&1; then
        TARGET_REF="master"
        git clone --quiet --depth 1 --branch "$TARGET_REF" --filter=blob:none --no-checkout "$REPO_URL" "$TMP_DIR" >/dev/null 2>&1 || { echo '[]'; exit 0; }
    fi
fi
cd "$TMP_DIR" || { echo '[]'; exit 0; }

# 3. Checkout only the target file
if ! git checkout "$TARGET_REF" -- "$TARGET_FILE" >/dev/null 2>&1; then
    echo "[]"
    exit 0
fi

# 4. Extract model IDs into a JSON array
# Finds strings starting with 'gemini-' inside single quotes, 
# ensuring they represent complete model names and excluding the embedding model.
if [ -f "$TARGET_FILE" ]; then
    RESULT=$(grep -oE "'gemini-[^']+'" "$TARGET_FILE" | \
      sed "s/'//g" | \
      grep -v "embedding" | \
      grep -v "custom" | \
      grep -vE "^gemini-[0-9.]+-$" | \
      grep -vE "^gemini-[0-9.]+$" | \
      sort -u | \
      jq -cR . | jq -cs .)
else
    RESULT="[]"
fi

# 5. Output the result
echo "${RESULT:-[]}"
