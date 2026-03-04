#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PACKAGE="@osanoai/multicli@latest"
SERVER_NAME="Multi-CLI"

echo ""
echo -e "${CYAN}${BOLD}  Multi-CLI MCP Installer${RESET}"
echo -e "${CYAN}  Bridging Claude, Gemini, and Codex${RESET}"
echo ""

# Detect available CLIs
CLAUDE_FOUND=false
GEMINI_FOUND=false
CODEX_FOUND=false

command -v claude &>/dev/null && CLAUDE_FOUND=true
command -v gemini &>/dev/null && GEMINI_FOUND=true
command -v codex  &>/dev/null && CODEX_FOUND=true

FOUND_COUNT=0
$CLAUDE_FOUND && ((FOUND_COUNT++)) || true
$GEMINI_FOUND && ((FOUND_COUNT++)) || true
$CODEX_FOUND  && ((FOUND_COUNT++)) || true

# Bail if nothing is installed
if [ "$FOUND_COUNT" -eq 0 ]; then
  echo -e "${RED}${BOLD}Error: No supported AI CLIs found on your PATH.${RESET}"
  echo ""
  echo "Multi-CLI requires at least one of the following to be installed:"
  echo "  • Claude Code  →  npm install -g @anthropic-ai/claude-code"
  echo "  • Gemini CLI   →  npm install -g @google/gemini-cli"
  echo "  • Codex CLI    →  npm install -g @openai/codex"
  echo ""
  echo "Install at least two for the full multi-model experience, then re-run this script."
  echo ""
  exit 1
fi

# Install for each detected CLI
INSTALLED=()
FAILED=()

if $CLAUDE_FOUND; then
  echo -e "  ${CYAN}→ Installing for Claude Code...${RESET}"
  if claude mcp add --scope user "$SERVER_NAME" -- npx -y "$PACKAGE" 2>/dev/null; then
    INSTALLED+=("Claude Code")
  else
    FAILED+=("Claude Code")
  fi
fi

if $GEMINI_FOUND; then
  echo -e "  ${CYAN}→ Installing for Gemini CLI...${RESET}"
  if gemini mcp add --scope user "$SERVER_NAME" npx -y "$PACKAGE" 2>/dev/null; then
    INSTALLED+=("Gemini CLI")
  else
    FAILED+=("Gemini CLI")
  fi
fi

if $CODEX_FOUND; then
  echo -e "  ${CYAN}→ Installing for Codex CLI...${RESET}"
  if codex mcp add "$SERVER_NAME" -- npx -y "$PACKAGE" 2>/dev/null; then
    INSTALLED+=("Codex CLI")
  else
    FAILED+=("Codex CLI")
  fi
fi

echo ""

# Report failures
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo -e "${YELLOW}${BOLD}  Warning: installation failed for:${RESET}"
  for cli in "${FAILED[@]}"; do
    echo -e "  ${YELLOW}• $cli${RESET}"
  done
  echo ""
fi

# Nothing installed
if [ "${#INSTALLED[@]}" -eq 0 ]; then
  echo -e "${RED}${BOLD}  Installation failed for all detected CLIs.${RESET}"
  echo "  Try running the install commands manually — see the README for details."
  echo ""
  exit 1
fi

# Success — warn if only one CLI was found (Multi-CLI needs multi)
if [ "$FOUND_COUNT" -eq 1 ]; then
  echo -e "${GREEN}${BOLD}  Installed for: ${INSTALLED[0]}${RESET}"
  echo ""
  echo -e "${YELLOW}${BOLD}  ⚠  Warning: only one AI CLI detected.${RESET}"
  echo -e "${YELLOW}  Multi-CLI is a collaboration tool — it bridges multiple AIs together.${RESET}"
  echo -e "${YELLOW}  With only ${INSTALLED[0]} installed, there's nothing to bridge to.${RESET}"
  echo ""
  echo "  Install at least one more CLI to unlock cross-model collaboration:"
  $CLAUDE_FOUND || echo "    • Claude Code  →  npm install -g @anthropic-ai/claude-code"
  $GEMINI_FOUND || echo "    • Gemini CLI   →  npm install -g @google/gemini-cli"
  $CODEX_FOUND  || echo "    • Codex CLI    →  npm install -g @openai/codex"
  echo ""
else
  echo -e "${GREEN}${BOLD}  Multi-CLI installed successfully!${RESET}"
  echo ""
  echo -e "  Installed for:"
  for cli in "${INSTALLED[@]}"; do
    echo -e "  ${GREEN}  ✓ $cli${RESET}"
  done
  echo ""
  echo -e "  Restart your AI client and the cross-model tools will appear automatically."
  echo -e "  No config. No API keys. No setup. Just works."
  echo ""
fi
