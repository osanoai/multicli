import { executeCommand } from './commandExecutor.js';
import { CLI } from '../constants.js';
import { ToolExecutionContext } from '../execution.js';

export async function executeGrokCLI(
  prompt: string,
  context?: ToolExecutionContext,
): Promise<string> {
  return executeCommand(
    CLI.COMMANDS.GROK,
    [CLI.GROK_FLAGS.PROMPT, prompt],
    context,
  );
}
