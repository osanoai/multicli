# Multi-CLI MCP

[![npm version](https://img.shields.io/npm/v/@osanoai/multicli)](https://www.npmjs.com/package/@osanoai/multicli)
[![Tests](https://img.shields.io/github/actions/workflow/status/osanoai/multicli/tests.yml?branch=main&label=tests)](https://github.com/osanoai/multicli/actions/workflows/tests.yml)
[![Scan](https://img.shields.io/github/actions/workflow/status/osanoai/multicli/scan.yml?branch=main&label=security%20scan)](https://github.com/osanoai/multicli/actions/workflows/scan.yml)
[![GitHub release](https://img.shields.io/github/v/release/osanoai/multicli)](https://github.com/osanoai/multicli/releases/latest)
[![Node](https://img.shields.io/node/v/@osanoai/multicli)](https://www.npmjs.com/package/@osanoai/multicli)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**An MCP server that lets Claude, Antigravity, Codex, and OpenCode call each other as tools.**

```
Claude:      "Hey Antigravity, what do you think about this code?"
Antigravity: "It's messy. Let me ask Codex for a second opinion."
Codex:       "You're both wrong. Here's the fix."
OpenCode:    "I checked with three providers. They all agree with Codex."
```

---

## One-Line Install (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/osanoai/multicli/main/install.sh | bash
```

Detects which AI CLIs you have installed and configures Multi-CLI for them automatically.

- Claude Code is configured to use a per-user local HTTP service on `127.0.0.1`
- Antigravity CLI, Codex CLI, and OpenCode keep using local config by default
- The installer may update client config files on your behalf

---

## What It Does

Multi-CLI sits between your AI clients and bridges them via the [Model Context Protocol](https://modelcontextprotocol.io/). Install it once, and whichever AI you're talking to gains the ability to call the others.

- **Claude** can ask Antigravity, Codex, or OpenCode for help
- **Antigravity** can delegate to Claude, Codex, or OpenCode
- **Codex** can consult Claude, Antigravity, or OpenCode
- **OpenCode** can call Claude, Antigravity, or Codex (across 75+ providers)
- Each client's own tools are hidden (no talking to yourself, that's weird)
- Auto-detects which CLIs you have installed — only shows what's available

---

## The Meta Part

This tool was built by the very AIs it connects.

Claude, Codex, Gemini, and OpenCode wrote the code. Claude, Codex, Gemini, and OpenCode maintain it. Every night, a CI job queries the latest stable release of the static-catalog CLIs for current model lists, diffs the results against what's in the repo, and automatically publishes a new version if anything changed. Antigravity models are discovered live through `agy models` because that command depends on local sign-in and account access.

The stdio install paths use `@latest`, so those clients pick up new releases automatically. Claude Code's managed HTTP service intentionally runs from a stable installed runtime instead of a transient `npx` cache; rerun the installer or `multicli service refresh --configure-claude` after upgrading.

Most MCP tools go stale within weeks. This one is self-maintaining by design.

---

## Prerequisites

You need **Node.js >= 20** and at least **one** of these CLIs installed:

| CLI | Install |
|-----|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) | `npm install -g @anthropic-ai/claude-code` |
| [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli) | Install Antigravity so `agy` is on your PATH |
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` |
| [OpenCode](https://opencode.ai) | `curl -fsSL https://opencode.ai/install | bash` |

> Multi-CLI is most useful with two or more CLIs installed. With only one, the install still works, but there may be nothing to bridge yet.

---

## Manual Installation

Prefer to install per-client yourself? Each command is one line.

### Claude Code

Recommended for Claude Code stability:

```bash
npm install -g @osanoai/multicli
multicli service install --configure-claude
```

This installs a per-user background service that listens only on `127.0.0.1`, configures Claude Code to use Multi-CLI over HTTP, and keeps the underlying server alive even if Claude drops a stdio subprocess.

The managed service installs as a per-user login/background service:

- macOS: `launchd` LaunchAgent
- Ubuntu/Debian: `systemd --user`
- Windows: Scheduled Task at user logon

Security model:

- Listens only on `127.0.0.1`
- Uses `Authorization: Bearer <token>` for every HTTP MCP request
- Stores generated service artifacts in a user-owned service directory

Operational notes:

- `multicli service install` refuses transient `npx` runtimes; use a global install or a stable local checkout
- Generated service state includes an env file you can edit if your local AI CLIs require additional credentials or PATH entries
- On Linux, the default `systemd --user` service follows your login session; enable `linger` yourself only if you intentionally want it to stay up after logout

Legacy stdio installation is still available:

```bash
claude mcp add --scope user Multi-CLI -- npx -y @osanoai/multicli@latest
```

<details>
<summary>Claude Desktop (JSON config)</summary>

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS:

```json
{
  "mcpServers": {
    "Multi-CLI": {
      "command": "npx",
      "args": ["-y", "@osanoai/multicli@latest"]
    }
  }
}
```

Restart Claude Desktop completely after saving.
</details>

---

### Antigravity CLI

```bash
mkdir -p ~/.gemini/config
node -e 'const fs=require("fs"),p=process.env.HOME+"/.gemini/config/mcp_config.json";let c={};if(fs.existsSync(p)){c=JSON.parse(fs.readFileSync(p,"utf8")||"{}")}c.mcpServers={...(c.mcpServers||{}),"Multi-CLI":{command:"npx",args:["-y","@osanoai/multicli@latest"]}};fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")'
```

<details>
<summary>Manual config (~/.gemini/config/mcp_config.json)</summary>

```json
{
  "mcpServers": {
    "Multi-CLI": {
      "command": "npx",
      "args": ["-y", "@osanoai/multicli@latest"]
    }
  }
}
```
</details>

---

### Codex CLI

```bash
codex mcp add Multi-CLI -- npx -y @osanoai/multicli@latest
```

<details>
<summary>Manual config (~/.codex/config.toml) or pass --mcp-config</summary>

```bash
codex --mcp-config mcp.json
```

Where `mcp.json` contains:

```json
{
  "mcpServers": {
    "Multi-CLI": {
      "command": "npx",
      "args": ["-y", "@osanoai/multicli@latest"]
    }
  }
}
```
</details>

---

### OpenCode

OpenCode's `mcp add` command is interactive, so add Multi-CLI to `~/.config/opencode/opencode.json` directly:

```json
{
  "mcp": {
    "Multi-CLI": {
      "type": "local",
      "command": ["npx", "-y", "@osanoai/multicli@latest"]
    }
  }
}
```

If the file already exists, merge the `"Multi-CLI"` entry into the existing `"mcp"` object.

---

### Any Other MCP Client

Multi-CLI supports both stdio and Streamable HTTP.

For stdio-capable clients, point them at:

```
npx -y @osanoai/multicli@latest
```

For a managed local HTTP service, install Multi-CLI globally and run:

```bash
multicli service install
```

The service listens on `127.0.0.1` only and exposes `/mcp` plus `/health`.

---

## Available Tools

Once connected, your AI client gains access to tools for the *other* CLIs (never its own):

| Tool | Description |
|------|-------------|
| `List-Antigravity-Models` | List available Antigravity models from `agy models` |
| `Ask-Antigravity` | Ask Antigravity a question or give it a task |
| `Fetch-Antigravity-Chunk` | Retrieve chunked responses from Antigravity changeMode |
| `Antigravity-Help` | Get Antigravity CLI help info |
| `List-Gemini-Models` | Deprecated alias for `List-Antigravity-Models` |
| `Ask-Gemini` | Deprecated alias for `Ask-Antigravity`; executes through `agy` |
| `Fetch-Chunk` | Deprecated alias for `Fetch-Antigravity-Chunk` |
| `Gemini-Help` | Deprecated alias for `Antigravity-Help` |
| `List-Codex-Models` | List available Codex models |
| `Ask-Codex` | Ask-Codex a question or give it a task |
| `Codex-Help` | Get Codex CLI help info |
| `List-Claude-Models` | List available Claude models |
| `Ask-Claude` | Ask-Claude a question or give it a task |
| `Claude-Help` | Get Claude Code CLI help info |
| `List-OpenCode-Models` | List available OpenCode models from all configured providers |
| `Ask-OpenCode` | Ask-OpenCode a question or give it a task |
| `OpenCode-Help` | Get OpenCode CLI help info |

---

## Task-Capable Ask Tools

The `Ask-*` tools still work as normal synchronous MCP tools, but they now also advertise optional task-based execution for MCP clients that support tasks.

- Task-capable clients can run long `Ask-*` calls using MCP tasks to avoid long blocking tool requests
- Older clients keep using the same `Ask-*` tools synchronously with no config changes
- `List-*`, `*-Help`, and `Fetch-Chunk` remain normal synchronous tools

---

## Usage Examples

Once installed, just talk naturally to your AI:

```
"Ask-Antigravity what it thinks about this architecture"
"Have Codex review this function for performance issues"
"Get Claude's opinion on this error message"
"Use OpenCode to get a second opinion from Llama"
```

Or get a second opinion on anything:

```
"I want three perspectives on how to refactor this module —
 ask Antigravity and Codex what they'd do differently"
```

---

## How It Works

```
┌─────────────┐     MCP (stdio)      ┌──────────────┐     CLI calls    ┌─────────────┐
│  Your AI    │ ◄──────────────────► │  Multi-CLI   │ ───────────────► │ Other AIs   │
│  Client     │                      │   server     │                  │ (CLI tools) │
└─────────────┘                      └──────────────┘                  └─────────────┘

1. Your AI client connects to Multi-CLI via MCP
2. Multi-CLI detects which CLIs are installed on your system
3. It registers tools for the OTHER clients (hides tools for the calling client)
4. When a tool is called, Multi-CLI executes the corresponding CLI command
5. Results flow back through MCP to your AI client
```

For Claude Code, Multi-CLI can also run as a local background HTTP service:

```
┌─────────────┐     MCP (HTTP)       ┌──────────────┐     CLI calls    ┌─────────────┐
│ Claude Code │ ◄──────────────────► │  Multi-CLI   │ ───────────────► │ Other AIs   │
│   Client    │    127.0.0.1 only    │   service    │                  │ (CLI tools) │
└─────────────┘                      └──────────────┘                  └─────────────┘
```

---

## Troubleshooting

**"No usable AI CLIs detected"**
Make sure at least one other CLI is installed and on your PATH:
```bash
which agy && which codex && which claude && which opencode
```

**No tools showing up?**
If only your own CLI is installed, Multi-CLI hides it (no self-calls). Install a *different* CLI to enable cross-model collaboration.

**MCP server not responding?**
1. Check that Node.js >= 20 is installed
2. Run `npx -y @osanoai/multicli@latest` directly to see if the stdio server starts
3. Restart your AI client completely

**Claude Code disconnecting after successful calls?**
Use the managed background service instead of the legacy stdio integration:

```bash
npm install -g @osanoai/multicli
multicli service install --configure-claude
multicli service doctor
```

Helpful service commands:

- `multicli service status`
- `multicli service doctor`
- `multicli service logs`
- `multicli service refresh`
- `multicli service uninstall`

**Need to tune timeouts or cleanup behavior?**
Multi-CLI supports these optional environment variables:

- `MULTICLI_TRANSPORT` (`stdio` or `http`)
- `MULTICLI_ASK_TIMEOUT_MS`
- `MULTICLI_HELP_TIMEOUT_MS`
- `MULTICLI_CLI_DETECT_TIMEOUT_MS`
- `MULTICLI_KILL_GRACE_MS`
- `MULTICLI_HTTP_HOST` (defaults to `127.0.0.1`)
- `MULTICLI_HTTP_PORT` (defaults to `37420`)
- `MULTICLI_HTTP_PATH` (defaults to `/mcp`)
- `MULTICLI_HTTP_AUTH_TOKEN` (required for direct HTTP mode)
- `MULTICLI_HTTP_SESSION_IDLE_MS`
- `MULTICLI_LOG_PATH` (defaults to `~/.multicli/logs/multicli.log`)
- `MULTICLI_LOG_LEVEL` (`error`, `info`, or `debug`; defaults to `debug` for the file log)
- `MULTICLI_STDERR_LOG_LEVEL` (`silent`, `error`, `info`, or `debug`; defaults to `error`)
- `MULTICLI_SERVICE_ROOT_DIR`
- `MULTICLI_SERVICE_LOG_PATH`
- `MULTICLI_SERVICE_ENV_PATH`
- `MULTICLI_SERVICE_MANIFEST_PATH`

The server writes structured JSON-line logs to a single file destination, rotates them automatically for long-running service mode, and includes full prompt bodies for `Ask-*` requests so disconnects and crashes can be reconstructed after the fact.

---

## Development

```bash
git clone https://github.com/osanoai/multicli.git
cd multicli
npm install
npm run build
npm run dev
```
