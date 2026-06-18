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
GLOBAL_PACKAGE="@osanoai/multicli@latest"
GLOBAL_MULTICLI_ENTRY=""
GLOBAL_INSTALL_READY=false

echo ""
echo -e "${CYAN}${BOLD}  Multi-CLI MCP Installer${RESET}"
echo -e "${CYAN}  Bridging Claude, Antigravity, Codex, and OpenCode${RESET}"
echo ""

# Detect available CLIs
CLAUDE_FOUND=false
ANTIGRAVITY_FOUND=false
GEMINI_FOUND=false
CODEX_FOUND=false
OPENCODE_FOUND=false

command -v claude   &>/dev/null && CLAUDE_FOUND=true
command -v agy      &>/dev/null && ANTIGRAVITY_FOUND=true && GEMINI_FOUND=true
command -v codex    &>/dev/null && CODEX_FOUND=true
command -v opencode &>/dev/null && OPENCODE_FOUND=true

install_global_multicli() {
  if $GLOBAL_INSTALL_READY; then
    return 0
  fi

  if ! command -v npm &>/dev/null; then
    echo -e "${YELLOW}  npm is required to install the managed Claude Code service.${RESET}"
    return 1
  fi

  echo -e "  ${CYAN}→ Installing stable Multi-CLI runtime for Claude Code...${RESET}"
  if ! npm install -g "$GLOBAL_PACKAGE" >/dev/null 2>&1; then
    return 1
  fi

  local npm_root
  npm_root="$(npm root -g 2>/dev/null || true)"
  if [ -z "$npm_root" ]; then
    return 1
  fi

  GLOBAL_MULTICLI_ENTRY="$npm_root/@osanoai/multicli/dist/index.js"
  if [ ! -f "$GLOBAL_MULTICLI_ENTRY" ]; then
    return 1
  fi

  GLOBAL_INSTALL_READY=true
  return 0
}

FOUND_COUNT=0
$CLAUDE_FOUND   && ((FOUND_COUNT++)) || true
$ANTIGRAVITY_FOUND && ((FOUND_COUNT++)) || true
$CODEX_FOUND    && ((FOUND_COUNT++)) || true
$OPENCODE_FOUND && ((FOUND_COUNT++)) || true

# Bail if nothing is installed
if [ "$FOUND_COUNT" -eq 0 ]; then
  echo -e "${RED}${BOLD}Error: No supported AI CLIs found on your PATH.${RESET}"
  echo ""
  echo "Multi-CLI requires at least one of the following to be installed:"
  echo "  • Claude Code  →  npm install -g @anthropic-ai/claude-code"
  echo "  • Antigravity  →  install the Antigravity CLI so the agy command is on PATH"
  echo "  • Codex CLI    →  npm install -g @openai/codex"
  echo "  • OpenCode     →  curl -fsSL https://opencode.ai/install | bash"
  echo ""
  echo "Install at least two for the full multi-model experience, then re-run this script."
  echo ""
  exit 1
fi

install_antigravity_config() {
  local config_dir="$HOME/.gemini/config"
  local config_file="$config_dir/mcp_config.json"
  mkdir -p "$config_dir"

  SERVER_NAME="$SERVER_NAME" PACKAGE="$PACKAGE" CONFIG_FILE="$config_file" node <<'NODE'
const fs = require('fs');
const path = require('path');

const configFile = process.env.CONFIG_FILE;
const serverName = process.env.SERVER_NAME;
const packageName = process.env.PACKAGE;
let cfg = {};

if (fs.existsSync(configFile)) {
  const raw = fs.readFileSync(configFile, 'utf8').trim();
  if (raw) {
    try {
      cfg = JSON.parse(raw);
    } catch {
      const backup = `${configFile}.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      fs.copyFileSync(configFile, backup);
      cfg = {};
      console.error(`Backed up malformed Antigravity MCP config to ${backup}`);
    }
  }
}

if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
  cfg = {};
}

cfg.mcpServers = cfg.mcpServers && typeof cfg.mcpServers === 'object' && !Array.isArray(cfg.mcpServers)
  ? cfg.mcpServers
  : {};
cfg.mcpServers[serverName] = {
  command: 'npx',
  args: ['-y', packageName],
};

const tmp = `${configFile}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
fs.renameSync(tmp, configFile);
NODE
}

# Install for each detected CLI
INSTALLED=()
FAILED=()

if $CLAUDE_FOUND; then
  echo -e "  ${CYAN}→ Installing for Claude Code...${RESET}"
  if install_global_multicli && node "$GLOBAL_MULTICLI_ENTRY" service install --configure-claude >/dev/null 2>&1; then
    INSTALLED+=("Claude Code")
  else
    FAILED+=("Claude Code")
  fi
fi

if $ANTIGRAVITY_FOUND; then
  echo -e "  ${CYAN}→ Installing for Antigravity CLI...${RESET}"
  if install_antigravity_config 2>/dev/null; then
    INSTALLED+=("Antigravity CLI")
  else
    FAILED+=("Antigravity CLI")
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

if $OPENCODE_FOUND; then
  echo -e "  ${CYAN}→ Installing for OpenCode...${RESET}"
  OPENCODE_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  OPENCODE_CONFIG="$OPENCODE_CONFIG_DIR/opencode.json"
  mkdir -p "$OPENCODE_CONFIG_DIR"

  # Build the MCP entry we want to add
  MCP_ENTRY='{"type":"local","command":["npx","-y","@osanoai/multicli@latest"]}'

  if [ -f "$OPENCODE_CONFIG" ]; then
    # Config exists — merge our MCP server into it using node (already required)
    if node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$OPENCODE_CONFIG', 'utf-8'));
      cfg.mcp = cfg.mcp || {};
      cfg.mcp['$SERVER_NAME'] = $MCP_ENTRY;
      fs.writeFileSync('$OPENCODE_CONFIG', JSON.stringify(cfg, null, 2) + '\n');
    " 2>/dev/null; then
      INSTALLED+=("OpenCode")
    else
      FAILED+=("OpenCode")
    fi
  else
    # No config — create one
    if printf '{\n  "mcp": {\n    "%s": %s\n  }\n}\n' "$SERVER_NAME" "$MCP_ENTRY" > "$OPENCODE_CONFIG" 2>/dev/null; then
      INSTALLED+=("OpenCode")
    else
      FAILED+=("OpenCode")
    fi
  fi
fi

echo ""

# Report failures
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo -e "${YELLOW}${BOLD}  Warning: installation failed for:${RESET}"
  for cli in "${FAILED[@]}"; do
    echo -e "  ${YELLOW}• $cli${RESET}"
  done
  if [[ " ${FAILED[*]} " == *" Claude Code "* ]]; then
    echo ""
    echo "  Claude Code manual fallback:"
    echo "    npm install -g @osanoai/multicli"
    echo "    multicli service install --configure-claude"
  fi
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
  echo -e "${YELLOW}  With only ${INSTALLED[0]} installed, there may be nothing to bridge to yet.${RESET}"
  echo ""
  echo "  Install at least one more CLI to unlock cross-model collaboration:"
  $CLAUDE_FOUND   || echo "    • Claude Code  →  npm install -g @anthropic-ai/claude-code"
  $ANTIGRAVITY_FOUND || echo "    • Antigravity  →  install the Antigravity CLI so the agy command is on PATH"
  $CODEX_FOUND    || echo "    • Codex CLI    →  npm install -g @openai/codex"
  $OPENCODE_FOUND || echo "    • OpenCode     →  curl -fsSL https://opencode.ai/install | bash"
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
  echo -e "  Claude Code now uses the managed local HTTP service; Antigravity, Codex, and OpenCode keep their local MCP configuration."
  echo ""
fi
