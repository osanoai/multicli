import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeCommand } from '../utils/commandExecutor.js';
import { formatCatalog } from '../modelCatalog.js';

const helpArgsSchema = z.object({});

export const geminiHelpTool: UnifiedTool = {
  name: "Gemini-Help",
  description: "Receive help information from the Gemini CLI",
  zodSchema: helpArgsSchema,
  prompt: {
    description: "Receive help information from the Gemini CLI",
  },
  category: 'gemini',
  execute: async (args, onProgress) => {
    return executeCommand("gemini", ["-help"], onProgress);
  }
};

export const codexHelpTool: UnifiedTool = {
  name: "Codex-Help",
  description: "Receive help information from the Codex CLI",
  zodSchema: helpArgsSchema,
  prompt: {
    description: "Receive help information from the Codex CLI",
  },
  category: 'codex',
  execute: async (args, onProgress) => {
    return executeCommand("codex", ["--help"], onProgress);
  }
};

export const claudeHelpTool: UnifiedTool = {
  name: "Claude-Help",
  description: "Receive help information from the Claude Code CLI",
  zodSchema: helpArgsSchema,
  prompt: {
    description: "Receive help information from the Claude Code CLI",
  },
  category: 'claude',
  execute: async (args, onProgress) => {
    return executeCommand("claude", ["--help"], onProgress);
  }
};

const noArgsSchema = z.object({});

export const geminiListModelsTool: UnifiedTool = {
  name: "List-Gemini-Models",
  description: "List available Gemini model families, their strengths, and known model IDs. You MUST call this before Ask-Gemini to choose the right model for your task. It's the law.",
  zodSchema: noArgsSchema,
  prompt: {
    description: "List available Gemini models with family descriptions",
  },
  category: 'gemini',
  execute: async () => {
    return formatCatalog('gemini');
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
