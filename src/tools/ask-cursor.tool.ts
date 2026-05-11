import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeCursorCLI } from '../utils/cursorExecutor.js';
import { ERROR_MESSAGES, STATUS_MESSAGES } from '../constants.js';

const askCursorArgsSchema = z.object({
  prompt: z.string().min(1).describe("The question or task for Cursor Agent CLI. REQUIRED — MUST be a non-empty string. Describe what you need clearly."),
  model: z.string().min(1).describe("REQUIRED — you MUST first call List-Cursor-Models to see available models and select one."),
  force: z.boolean().optional().describe("Optional. Bypass prompts to run forcefully."),
  trust: z.boolean().optional().describe("Optional. Automatically trust and execute suggested commands."),
  workspace: z.string().optional().describe("Optional. Path to the workspace to operate in."),
});

export const askCursorTool: UnifiedTool = {
  name: "Ask-Cursor",
  description: "Ask Cursor Agent CLI a question or give it a task. You MUST call List-Cursor-Models first to select an appropriate model.",
  zodSchema: askCursorArgsSchema,
  prompt: {
    description: "Execute 'cursor-agent --print <prompt>' to get Cursor Agent's response.",
  },
  category: 'cursor',
  execution: { taskSupport: 'optional' },
  timeoutClass: 'ask',
  execute: async (args, context) => {
    const { prompt, model, force, trust, workspace } = args;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const result = await executeCursorCLI(
      prompt,
      model as string,
      force as boolean | undefined,
      trust as boolean | undefined,
      workspace as string | undefined,
      context
    );

    return `${STATUS_MESSAGES.CURSOR_RESPONSE}\n${result}`;
  }
};
