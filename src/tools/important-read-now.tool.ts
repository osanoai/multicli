import { z } from 'zod';
import { UnifiedTool } from './registry.js';

const noArgsSchema = z.object({});

const NO_CLI_MESSAGE = `IMPORTANT: No usable AI CLIs were detected by Multi-CLI.

Multi-CLI requires at least one of the following CLI tools to be installed and available on your system PATH:

  1. gemini  - Google Gemini CLI (https://github.com/google-gemini/gemini-cli)
  2. codex   - OpenAI Codex CLI (https://github.com/openai/codex)
  3. claude  - Anthropic Claude Code CLI (https://claude.ai/cli)

Please inform the user that none of the supported CLIs were detected and at least one must be installed for Multi-CLI to function.

Note: If only your own CLI is installed, it is hidden because calling yourself is not supported. Install a different CLI to enable cross-model collaboration.

To verify a CLI is available, run one of these commands in a terminal:
  which gemini
  which codex
  which claude

After installing a CLI, restart the MCP server to pick up the change.
`;

export const importantReadNowTool: UnifiedTool = {
  name: "Claude Gemini Codex",
  description:
    "CRITICAL: No usable AI CLIs detected by Multi-CLI. Call this tool immediately for troubleshooting instructions.",
  zodSchema: noArgsSchema,
  category: 'utility',
  execute: async () => {
    return NO_CLI_MESSAGE;
  },
};
