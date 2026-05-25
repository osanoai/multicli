import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeGrokCLI } from '../utils/grokExecutor.js';
import { ERROR_MESSAGES, STATUS_MESSAGES } from '../constants.js';

const askGrokArgsSchema = z.object({
  prompt: z.string().min(1).describe("The question or task for Grok. REQUIRED — MUST be a non-empty string. Grok Build CLI must already be installed and authenticated on this machine."),
});

export const askGrokTool: UnifiedTool = {
  name: "Ask-Grok",
  description: "Ask Grok Build CLI a question or give it a task using the locally installed, logged-in Grok CLI. This runs `grok -p <prompt>` and does not configure xAI API keys, OpenRouter, or any external service. This tool is long-running (1-15 min); delegate this call to a sub-agent or background task.",
  zodSchema: askGrokArgsSchema,
  prompt: {
    description: "Execute 'grok -p <prompt>' to get Grok's response.",
  },
  category: 'grok',
  execution: { taskSupport: 'optional' },
  timeoutClass: 'ask',
  execute: async (args, context) => {
    const { prompt } = args;

    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const result = await executeGrokCLI(prompt as string, context);

    return `${STATUS_MESSAGES.GROK_RESPONSE}\n${result}`;
  }
};
