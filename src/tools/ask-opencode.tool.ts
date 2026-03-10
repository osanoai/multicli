import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeOpencodeCLI } from '../utils/opencodeExecutor.js';
import { ERROR_MESSAGES, STATUS_MESSAGES } from '../constants.js';

const askOpencodeArgsSchema = z.object({
  prompt: z.string().min(1).describe("The question or task for OpenCode. REQUIRED — MUST be a non-empty string. OpenCode has full filesystem access and will read files itself. Do NOT pre-read or inline file contents — just describe the task."),
  model: z.string().min(1).describe("REQUIRED — you MUST first call List-OpenCode-Models, review the available models and their tiers, then select the best model for your task. Use the full provider/model format (e.g., 'google-vertex/gemini-2.5-flash'). Empty strings will be rejected."),
});

export const askOpencodeTool: UnifiedTool = {
  name: "Ask-OpenCode",
  description: "Ask OpenCode a question or give it a task. OpenCode supports multiple AI providers and has full filesystem access. You MUST call List-OpenCode-Models first to select an appropriate model. Use the full provider/model format for the model parameter.",
  zodSchema: askOpencodeArgsSchema,
  prompt: {
    description: "Execute 'opencode run <prompt> -m <model>' to get OpenCode's response.",
  },
  category: 'opencode',
  execute: async (args, onProgress) => {
    const { prompt, model } = args;

    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const result = await executeOpencodeCLI(
      prompt as string,
      model as string,
      onProgress
    );

    return `${STATUS_MESSAGES.OPENCODE_RESPONSE}\n${result}`;
  }
};
