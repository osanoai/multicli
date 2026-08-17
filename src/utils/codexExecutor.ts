import { executeCommand } from './commandExecutor.js';
import { getCodexCapabilities } from './codexCapabilities.js';
import { CLI } from '../constants.js';
import { ToolExecutionContext } from '../execution.js';

export async function executeCodexCLI(
  prompt: string,
  model: string,
  sandbox?: string,
  approvalPolicy?: string,
  context?: ToolExecutionContext,
): Promise<string> {
  const capabilities = await getCodexCapabilities(context);

  const args: string[] = [CLI.SUBCOMMANDS.EXEC, prompt];

  if (capabilities.approveForMe) {
    // --approve-for-me is rejected alongside -s, so an explicit sandbox wins and
    // the run is kept unattended through approval_policy below instead.
    if (!sandbox) {
      args.push(CLI.CODEX_FLAGS.APPROVE_FOR_ME);
    }
  } else {
    args.push(CLI.CODEX_FLAGS.FULL_AUTO);
  }

  args.push(
    CLI.CODEX_FLAGS.SKIP_GIT_CHECK,
    CLI.CODEX_FLAGS.COLOR, "never",
    CLI.CODEX_FLAGS.MODEL, model,
  );

  if (sandbox) {
    args.push(CLI.CODEX_FLAGS.SANDBOX, sandbox);
  }

  if (capabilities.askForApprovalFlag) {
    if (approvalPolicy) {
      args.push(CLI.CODEX_FLAGS.APPROVAL, approvalPolicy);
    }
  } else {
    const policy = approvalPolicy
      ?? (sandbox ? CLI.CODEX_APPROVAL_POLICIES.NEVER : undefined);

    if (policy) {
      args.push(
        CLI.CODEX_FLAGS.CONFIG,
        `${CLI.CODEX_CONFIG_KEYS.APPROVAL_POLICY}=${policy}`,
      );
    }
  }

  return executeCommand(CLI.COMMANDS.CODEX, args, context);
}
