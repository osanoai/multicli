import { executeCommand } from './commandExecutor.js';
import { CLI } from '../constants.js';
import { ToolExecutionContext } from '../execution.js';

export async function executeCodexCLI(
  prompt: string,
  model: string,
  sandbox?: string,
  approvalPolicy?: string,
  context?: ToolExecutionContext,
): Promise<string> {
  const args: string[] = [
    CLI.SUBCOMMANDS.EXEC, prompt,
    CLI.CODEX_FLAGS.FULL_AUTO,
    CLI.CODEX_FLAGS.SKIP_GIT_CHECK,
    CLI.CODEX_FLAGS.COLOR, "never",
    CLI.CODEX_FLAGS.MODEL, model,
  ];

  if (sandbox) {
    args.push(CLI.CODEX_FLAGS.SANDBOX, sandbox);
  }

  if (approvalPolicy) {
    args.push(CLI.CODEX_FLAGS.APPROVAL, approvalPolicy);
  }

  // Issue #138: Codex-only opt-in to bypass cmd.exe on Windows when the env flag is set.
  // Other CLIs intentionally do not read this flag. When the flag is off, we forward
  // `context` unchanged so the existing call shape is preserved.
  const noShellEnv = process.env.MULTICLI_WINDOWS_CODEX_NO_SHELL === '1';
  const codexContext = noShellEnv
    ? { ...(context ?? {}), windowsCodexNoShell: true }
    : context;
  return executeCommand(CLI.COMMANDS.CODEX, args, codexContext);
}
