# Osano AI - Multi CLI MCP

[![npm version](https://img.shields.io/npm/v/@osanoai/multicli?color=cb0000)](https://www.npmjs.com/package/@osanoai/multicli)
[![Tests](https://img.shields.io/github/actions/workflow/status/osanoai/multicli/tests.yml?branch=main&label=tests)](https://github.com/osanoai/multicli/actions/workflows/tests.yml)
[![Scan](https://img.shields.io/github/actions/workflow/status/osanoai/multicli/scan.yml?branch=main&label=security%20scan)](https://github.com/osanoai/multicli/actions/workflows/scan.yml)
[![GitHub release](https://img.shields.io/github/v/release/osanoai/multicli)](https://github.com/osanoai/multicli/releases/latest)
[![Node](https://img.shields.io/node/v/@osanoai/multicli)](https://www.npmjs.com/package/@osanoai/multicli)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**The AI collab no one asked for, but everyone needed.**

An MCP server that lets Claude, Gemini, and Codex call each other as tools. Because why argue about which AI is best when you can make them work together?

```
Claude: "Hey Gemini, what do you think about this code?"
Gemini: "It's mass. Let me ask Codex for a second opinion."
Codex:  "You're both wrong. Here's the fix."
```

## What It Does

Multi-CLI sits between your AI clients and bridges them via the [Model Context Protocol](https://modelcontextprotocol.io/). Install it once, and whichever AI you're talking to gains the ability to call the others.

- **Claude** can ask Gemini or Codex for help
- **Gemini** can delegate to Claude or Codex
- **Codex** can consult Claude or Gemini
- Each client's own tools are hidden (no talking to yourself, that's weird)
- Auto-detects which CLIs you have installed — only shows what's available

## Prerequisites

You need **Node.js >= 20** and at least **two** of these CLIs installed:

| CLI | Install |
|-----|---------|
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) | `npm install -g @anthropic-ai/claude-code` |
| [Codex CLI](https://github.com/openai/codex) | `npm install -g @openai/codex` |

> Why two? Because one AI talking to itself is a monologue, not a collaboration.

---

## Installation

### Claude Code

```bash
claude mcp add Multi-CLI -- npx -y @osanoai/multicli
```

That's it. Restart Claude Code and Gemini + Codex tools appear automatically.

<details>
<summary>Claude Desktop (JSON config)</summary>

Add to your config file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "Multi-CLI": {
      "command": "npx",
      "args": ["-y", "@osanoai/multicli"]
    }
  }
}
```

Restart Claude Desktop completely after saving.
</details>

---

### Gemini CLI

```bash
gemini mcp add --scope user Multi-CLI npx -y @osanoai/multicli
```

Restart the Gemini CLI and Claude + Codex tools will be available.

<details>
<summary>Manual config (~/.gemini/settings.json)</summary>

```json
{
  "mcpServers": {
    "Multi-CLI": {
      "command": "npx",
      "args": ["-y", "@osanoai/multicli"]
    }
  }
}
```
</details>

---

### Codex CLI

```bash
codex mcp add Multi-CLI -- npx -y @osanoai/multicli
```

Restart Codex and Claude + Gemini tools will be available.

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
      "args": ["-y", "@osanoai/multicli"]
    }
  }
}
```
</details>

---

### Any Other MCP Client

Multi-CLI uses standard stdio transport. If your client supports MCP, point it at:

```
npx -y @osanoai/multicli
```

---

## Available Tools

Once connected, your AI client gains access to tools for the *other* CLIs (never its own):

| Tool | Description |
|------|-------------|
| `List Gemini Models` | List available Gemini models and their strengths |
| `Ask Gemini` | Ask Gemini a question or give it a task |
| `Fetch Chunk` | Retrieve chunked responses from Gemini |
| `Gemini Help` | Get Gemini CLI help info |
| `List Codex Models` | List available Codex models |
| `Ask Codex` | Ask Codex a question or give it a task |
| `Codex Help` | Get Codex CLI help info |
| `List Claude Models` | List available Claude models |
| `Ask Claude` | Ask Claude a question or give it a task |
| `Claude Help` | Get Claude Code CLI help info |

## Usage Examples

Once installed, just talk naturally to your AI:

```
"Ask Gemini what it thinks about this architecture"
"Have Codex review this function for performance issues"
"Get Claude's opinion on this error message"
"Use Gemini to analyze @largefile.js"
```

Or get a second opinion on anything:

```
"I want three perspectives on how to refactor this module —
 ask Gemini and Codex what they'd do differently"
```

## How It Works

```
┌─────────────┐     MCP (stdio)     ┌──────────────┐     CLI calls     ┌─────────────┐
│  Your AI    │ ◄──────────────────► │ Multi-CLI │ ───────────────► │ Other AIs   │
│  Client     │                      │   server     │                   │ (CLI tools) │
└─────────────┘                      └──────────────┘                   └─────────────┘

1. Your AI client connects to Multi-CLI via MCP
2. Multi-CLI detects which CLIs are installed on your system
3. It registers tools for the OTHER clients (hides tools for the calling client)
4. When a tool is called, Multi-CLI executes the corresponding CLI command
5. Results flow back through MCP to your AI client
```

## Troubleshooting

**"No usable AI CLIs detected"**
Make sure at least one other CLI is installed and on your PATH:
```bash
which gemini && which codex && which claude
```

**No tools showing up?**
If only your own CLI is installed, Multi-CLI hides it (no self-calls). Install a *different* CLI to enable cross-model collaboration.

**MCP server not responding?**
1. Check that Node.js >= 20 is installed
2. Run `npx @osanoai/multicli` directly to see if it starts
3. Restart your AI client completely

## Development

```bash
git clone https://github.com/osanoai/multicli.git
cd multicli
npm install
npm run build
npm run dev
```

