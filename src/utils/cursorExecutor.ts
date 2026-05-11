import { executeCommand } from './commandExecutor.js';
import { CLI } from '../constants.js';
import { ToolExecutionContext } from '../execution.js';

export async function executeCursorCLI(
  prompt: string,
  model: string,
  force?: boolean,
  trust?: boolean,
  workspace?: string,
  context?: ToolExecutionContext,
): Promise<string> {
  const args: string[] = [
    CLI.CURSOR_FLAGS.PRINT,
    CLI.CURSOR_FLAGS.OUTPUT_FORMAT, "text",
    CLI.CURSOR_FLAGS.MODEL, model,
  ];

  if (force) {
    args.push(CLI.CURSOR_FLAGS.FORCE);
  }

  if (trust) {
    args.push(CLI.CURSOR_FLAGS.TRUST);
  }

  if (workspace) {
    args.push(CLI.CURSOR_FLAGS.WORKSPACE, workspace);
  }

  args.push(prompt);

  return executeCommand(CLI.COMMANDS.CURSOR, args, context);
}
