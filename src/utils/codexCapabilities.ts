import { executeCommand } from './commandExecutor.js';
import { CLI } from '../constants.js';
import { ToolExecutionContext } from '../execution.js';

/**
 * Flag support of the installed Codex CLI.
 *
 * `codex exec` dropped `--full-auto` and `-a/--ask-for-approval` in newer releases,
 * replacing them with `--approve-for-me` and `-c approval_policy=<value>`. Version
 * numbers don't tell us reliably when that happened, so we read the CLI's own help
 * output instead.
 */
export interface CodexCapabilities {
  approveForMe: boolean;
  askForApprovalFlag: boolean;
}

const LEGACY_CAPABILITIES: CodexCapabilities = {
  approveForMe: false,
  askForApprovalFlag: true,
};

const PROBE_TIMEOUT_MS = 15000;

let cached: Promise<CodexCapabilities> | undefined;

/** Clear the per-process probe result. Test seam. */
export function resetCodexCapabilitiesCache(): void {
  cached = undefined;
}

async function probeCodexCapabilities(context: ToolExecutionContext): Promise<CodexCapabilities> {
  // Help output is noise for the caller — never stream it through onProgress.
  const { onProgress: _onProgress, ...probeContext } = context;

  const help = await executeCommand(
    CLI.COMMANDS.CODEX,
    [CLI.SUBCOMMANDS.EXEC, CLI.CODEX_FLAGS.HELP],
    { ...probeContext, timeoutMs: probeContext.timeoutMs ?? PROBE_TIMEOUT_MS },
  );

  const capabilities: CodexCapabilities = {
    approveForMe: help.includes(CLI.CODEX_FLAGS.APPROVE_FOR_ME),
    askForApprovalFlag: help.includes(CLI.CODEX_FLAGS.ASK_FOR_APPROVAL),
  };

  context.logger?.info('codex_capabilities_detected', { capabilities });

  return capabilities;
}

export async function getCodexCapabilities(
  context: ToolExecutionContext = {},
): Promise<CodexCapabilities> {
  if (cached) {
    return cached;
  }

  const pending: Promise<CodexCapabilities> = probeCodexCapabilities(context).catch((error) => {
    // A transient probe failure must not pin legacy flags for the rest of the process.
    if (cached === pending) {
      cached = undefined;
    }
    context.logger?.error('codex_capability_probe_failed', { error });
    return LEGACY_CAPABILITIES;
  });

  cached = pending;

  return pending;
}
