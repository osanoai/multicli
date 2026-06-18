import { ToolExecutionContext } from '../execution.js';
import {
  executeAntigravityCLI,
  processChangeModeOutput,
} from './antigravityExecutor.js';

export async function executeGeminiCLI(
  prompt: string,
  model: string,
  sandbox?: boolean,
  changeMode?: boolean,
  context?: ToolExecutionContext,
): Promise<string> {
  return executeAntigravityCLI(prompt, model, sandbox, changeMode, context);
}

export { processChangeModeOutput };
