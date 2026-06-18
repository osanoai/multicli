import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeGeminiCLI, processChangeModeOutput } from '../utils/geminiExecutor.js';
import { 
  ERROR_MESSAGES, 
  STATUS_MESSAGES
} from '../constants.js';

const askGeminiArgsSchema = z.object({
  prompt: z.string().min(1).describe("The question or task for Antigravity through the deprecated Gemini alias. REQUIRED — MUST be a non-empty string. Antigravity has filesystem access via @ syntax — use @ syntax to reference files (e.g., '@src/index.ts review this'). Do NOT pre-read or inline file contents — just describe the task and reference files with @."),
  model: z.string().min(1).describe("REQUIRED — you MUST first call List-Gemini-Models or List-Antigravity-Models, review the available Antigravity model names and tiers, then pass the exact returned model name. Empty strings will be rejected."),
  sandbox: z.boolean().default(false).describe("Optional. Do NOT set unless explicitly needed. Run in Antigravity sandbox mode (--sandbox flag) for safely testing code changes in an isolated environment. Defaults to false."),
  changeMode: z.boolean().default(false).describe("Optional. Do NOT set unless explicitly needed. Return structured edit suggestions instead of plain text. Defaults to false."),
  chunkIndex: z.union([z.number(), z.string()]).optional().describe("Internal — do NOT set unless you received a chunked changeMode response. Which chunk to return (1-based)."),
  chunkCacheKey: z.string().optional().describe("Internal — do NOT set unless you received a chunked changeMode response. Cache key from a prior response for fetching subsequent chunks."),
});

export const askGeminiTool: UnifiedTool = {
  name: "Ask-Gemini",
  description: "Deprecated compatibility alias for Ask-Antigravity. Executes Google Antigravity via `agy`, not the legacy `gemini` binary. Use Ask-Antigravity for new workflows.",
  zodSchema: askGeminiArgsSchema,
  prompt: {
    description: "Deprecated alias: execute Antigravity via `agy --print <prompt>`. Supports enhanced change mode for structured edit suggestions.",
  },
  category: 'gemini',
  execution: { taskSupport: 'optional' },
  timeoutClass: 'ask',
  execute: async (args, context) => {
    const { prompt, model, sandbox, changeMode, chunkIndex, chunkCacheKey } = args; if (!prompt?.trim()) { throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED); }
  
    if (changeMode && chunkIndex && chunkCacheKey) {
      return processChangeModeOutput(
        '', // empty for cache...
        chunkIndex as number,
        chunkCacheKey as string,
        prompt as string
      );
    }
    
    const result = await executeGeminiCLI(
      prompt as string,
      model as string,
      !!sandbox,
      !!changeMode,
      context
    );
    
    if (changeMode) {
      return processChangeModeOutput(
        result,
        args.chunkIndex as number | undefined,
        undefined,
        prompt as string
      );
    }
    return `DEPRECATION: Ask-Gemini is a compatibility alias. This request was executed by Antigravity via \`agy\`. Use Ask-Antigravity for new workflows.\n\n${STATUS_MESSAGES.ANTIGRAVITY_RESPONSE}\n${result}`; // changeMode false
  }
};
