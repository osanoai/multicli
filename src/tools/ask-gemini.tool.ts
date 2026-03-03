import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeGeminiCLI, processChangeModeOutput } from '../utils/geminiExecutor.js';
import { 
  ERROR_MESSAGES, 
  STATUS_MESSAGES
} from '../constants.js';

const askGeminiArgsSchema = z.object({
  prompt: z.string().min(1).describe("The question or task for Gemini. REQUIRED — MUST be a non-empty string. Gemini has filesystem access — use @ syntax to reference files (e.g., '@src/index.ts review this'). Do NOT pre-read or inline file contents — just describe the task and reference files with @."),
  model: z.string().min(1).describe("REQUIRED — you MUST first call List Gemini Models, review the available model families and their strengths, then select the best model for your task's scope and complexity. It's the law. Empty strings will be rejected."),
  sandbox: z.boolean().default(false).describe("Optional. Do NOT set unless explicitly needed. Run in sandbox mode (-s flag) for safely testing code changes in an isolated environment. Defaults to false."),
  changeMode: z.boolean().default(false).describe("Optional. Do NOT set unless explicitly needed. Return structured edit suggestions instead of plain text. Defaults to false."),
  chunkIndex: z.union([z.number(), z.string()]).optional().describe("Internal — do NOT set unless you received a chunked changeMode response. Which chunk to return (1-based)."),
  chunkCacheKey: z.string().optional().describe("Internal — do NOT set unless you received a chunked changeMode response. Cache key from a prior response for fetching subsequent chunks."),
});

export const askGeminiTool: UnifiedTool = {
  name: "Ask Gemini",
  description: "Ask Google Gemini a question or give it a task. Gemini has filesystem access via @ syntax — do NOT pre-gather context or inline file contents into the prompt. Just describe what you need and use @file references. You MUST call List Gemini Models first to select an appropriate model. Do NOT set optional parameters unless you have a specific reason.",
  zodSchema: askGeminiArgsSchema,
  prompt: {
    description: "Execute 'gemini <prompt>' to get Gemini AI's response. Supports enhanced change mode for structured edit suggestions.",
  },
  category: 'gemini',
  execute: async (args, onProgress) => {
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
      onProgress
    );
    
    if (changeMode) {
      return processChangeModeOutput(
        result,
        args.chunkIndex as number | undefined,
        undefined,
        prompt as string
      );
    }
    return `${STATUS_MESSAGES.GEMINI_RESPONSE}\n${result}`; // changeMode false
  }
};