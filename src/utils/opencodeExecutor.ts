import { executeCommand } from './commandExecutor.js';
import { CLI } from '../constants.js';

export async function executeOpencodeCLI(
  prompt: string,
  model: string,
  onProgress?: (newOutput: string) => void
): Promise<string> {
  const args: string[] = [
    CLI.OPENCODE_SUBCOMMANDS.RUN,
    prompt,
    CLI.OPENCODE_FLAGS.MODEL, model,
  ];

  return executeCommand(CLI.COMMANDS.OPENCODE, args, onProgress);
}
