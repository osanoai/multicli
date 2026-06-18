import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeAntigravityCLI, processChangeModeOutput } from '../utils/antigravityExecutor.js';
import {
  ERROR_MESSAGES,
  STATUS_MESSAGES,
} from '../constants.js';

const askAntigravityArgsSchema = z.object({
  prompt: z.string().min(1).describe("The question or task for Antigravity. REQUIRED — MUST be a non-empty string. Antigravity has filesystem access via @ syntax — use @ syntax to reference files (e.g., '@src/index.ts review this'). Do NOT pre-read or inline file contents — just describe the task and reference files with @."),
  model: z.string().min(1).describe("REQUIRED — you MUST first call List-Antigravity-Models, review the available model names and tiers, then pass the exact returned model name. Empty strings will be rejected."),
  sandbox: z.boolean().default(false).describe("Optional. Do NOT set unless explicitly needed. Run in Antigravity sandbox mode (--sandbox flag) for safely testing code changes in an isolated environment. Defaults to false."),
  changeMode: z.boolean().default(false).describe("Optional. Do NOT set unless explicitly needed. Return structured edit suggestions instead of plain text. Defaults to false."),
  chunkIndex: z.union([z.number(), z.string()]).optional().describe("Internal — do NOT set unless you received a chunked changeMode response. Which chunk to return (1-based)."),
  chunkCacheKey: z.string().optional().describe("Internal — do NOT set unless you received a chunked changeMode response. Cache key from a prior response for fetching subsequent chunks."),
});

export const askAntigravityTool: UnifiedTool = {
  name: "Ask-Antigravity",
  description: "Ask Google Antigravity a question or give it a task. Antigravity has filesystem access via @ syntax — do NOT pre-gather context or inline file contents into the prompt. Just describe what you need and use @file references. You MUST call List-Antigravity-Models first to select an exact model name. This tool is long-running (1-15 min); delegate this call to a sub-agent or background task.",
  zodSchema: askAntigravityArgsSchema,
  prompt: {
    description: "Execute 'agy --print <prompt>' to get Antigravity's response. Supports enhanced change mode for structured edit suggestions.",
  },
  category: 'antigravity',
  execution: { taskSupport: 'optional' },
  timeoutClass: 'ask',
  execute: async (args, context) => {
    const { prompt, model, sandbox, changeMode, chunkIndex, chunkCacheKey } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    if (changeMode && chunkIndex && chunkCacheKey) {
      return processChangeModeOutput(
        '',
        chunkIndex as number,
        chunkCacheKey as string,
        prompt as string,
      );
    }

    const result = await executeAntigravityCLI(
      prompt as string,
      model as string,
      !!sandbox,
      !!changeMode,
      context,
    );

    if (changeMode) {
      return processChangeModeOutput(
        result,
        args.chunkIndex as number | undefined,
        undefined,
        prompt as string,
      );
    }

    return `${STATUS_MESSAGES.ANTIGRAVITY_RESPONSE}\n${result}`;
  },
};
