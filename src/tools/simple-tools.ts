import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeCommand } from '../utils/commandExecutor.js';
import { formatCatalog } from '../modelCatalog.js';
import { getOpencodeClassifiedCatalog } from '../utils/opencodeCatalog.js';
import { getAntigravityClassifiedCatalog } from '../utils/antigravityCatalog.js';
import { CLI } from '../constants.js';

const helpArgsSchema = z.object({});

export const geminiHelpTool: UnifiedTool = {
  name: "Gemini-Help",
  description: "Deprecated compatibility alias for Antigravity-Help. Executes `agy --help`.",
  zodSchema: helpArgsSchema,
  prompt: {
    description: "Deprecated alias: receive help information from the Antigravity CLI",
  },
  category: 'gemini',
  timeoutClass: 'help',
  execute: async (_args, context) => {
    const help = await executeCommand(CLI.COMMANDS.ANTIGRAVITY, [CLI.ANTIGRAVITY_FLAGS.HELP], context);
    return `DEPRECATION: Gemini-Help is a compatibility alias. This help was produced by Antigravity via \`agy --help\`. Use Antigravity-Help for new workflows.\n\n${help}`;
  },
};

export const antigravityHelpTool: UnifiedTool = {
  name: "Antigravity-Help",
  description: "Receive help information from the Antigravity CLI",
  zodSchema: helpArgsSchema,
  prompt: {
    description: "Receive help information from the Antigravity CLI",
  },
  category: 'antigravity',
  timeoutClass: 'help',
  execute: async (_args, context) => executeCommand(CLI.COMMANDS.ANTIGRAVITY, [CLI.ANTIGRAVITY_FLAGS.HELP], context),
};

export const codexHelpTool: UnifiedTool = {
  name: "Codex-Help",
  description: "Receive help information from the Codex CLI",
  zodSchema: helpArgsSchema,
  prompt: {
    description: "Receive help information from the Codex CLI",
  },
  category: 'codex',
  timeoutClass: 'help',
  execute: async (_args, context) => executeCommand("codex", ["--help"], context),
};

export const claudeHelpTool: UnifiedTool = {
  name: "Claude-Help",
  description: "Receive help information from the Claude Code CLI",
  zodSchema: helpArgsSchema,
  prompt: {
    description: "Receive help information from the Claude Code CLI",
  },
  category: 'claude',
  timeoutClass: 'help',
  execute: async (_args, context) => executeCommand("claude", ["--help"], context),
};

const noArgsSchema = z.object({});

export const geminiListModelsTool: UnifiedTool = {
  name: "List-Gemini-Models",
  description: "Deprecated compatibility alias for List-Antigravity-Models. Lists the full Antigravity model catalog from `agy models`; use the exact returned model name.",
  zodSchema: noArgsSchema,
  prompt: {
    description: "Deprecated alias: list available Antigravity models with tier classifications",
  },
  category: 'gemini',
  execute: async (_args, context) => {
    return getAntigravityClassifiedCatalog(context, true);
  }
};

export const antigravityListModelsTool: UnifiedTool = {
  name: "List-Antigravity-Models",
  description: "List available Antigravity models from `agy models`, classify them into tiers, and tell callers to pass the exact returned model name to Ask-Antigravity.",
  zodSchema: noArgsSchema,
  prompt: {
    description: "List available Antigravity models with tier classifications",
  },
  category: 'antigravity',
  execute: async (_args, context) => {
    return getAntigravityClassifiedCatalog(context);
  }
};

export const codexListModelsTool: UnifiedTool = {
  name: "List-Codex-Models",
  description: "List available Codex model families, their strengths, and known model IDs. You MUST call this before Ask-Codex to choose the right model for your task. It's the law.",
  zodSchema: noArgsSchema,
  prompt: {
    description: "List available Codex models with family descriptions",
  },
  category: 'codex',
  execute: async () => {
    return formatCatalog('codex');
  }
};

export const claudeListModelsTool: UnifiedTool = {
  name: "List-Claude-Models",
  description: "List available Claude model families, their strengths, and known model IDs. You MUST call this before Ask-Claude to choose the right model for your task. It's the law.",
  zodSchema: noArgsSchema,
  prompt: {
    description: "List available Claude models with family descriptions",
  },
  category: 'claude',
  execute: async () => {
    return formatCatalog('claude');
  }
};

export const opencodeHelpTool: UnifiedTool = {
  name: "OpenCode-Help",
  description: "Receive help information from the OpenCode CLI",
  zodSchema: helpArgsSchema,
  prompt: {
    description: "Receive help information from the OpenCode CLI",
  },
  category: 'opencode',
  timeoutClass: 'help',
  execute: async (_args, context) => executeCommand("opencode", ["--help"], context),
};

export const opencodeListModelsTool: UnifiedTool = {
  name: "List-OpenCode-Models",
  description: "List available OpenCode models from all configured providers, classified into tiers. You MUST call this before Ask-OpenCode to choose the right model for your task. Models are dynamically discovered from your providers.",
  zodSchema: noArgsSchema,
  prompt: {
    description: "List available OpenCode models with tier classifications",
  },
  category: 'opencode',
  execute: async () => {
    return getOpencodeClassifiedCatalog();
  }
};
