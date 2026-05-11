import { spawn } from 'child_process';
import { ToolExecutionContext } from '../execution.js';

export type GhFailureKind = 'missing-cli' | 'unauthenticated' | 'forbidden' | 'not-found' | 'failed';

export class GhCliError extends Error {
  constructor(
    public readonly kind: GhFailureKind,
    message: string,
    public readonly details: {
      command: string;
      args: string[];
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
    },
  ) {
    super(message);
    this.name = 'GhCliError';
  }
}

export async function executeGhCommand(
  args: string[],
  context?: ToolExecutionContext,
): Promise<string> {
  const command = 'gh';
  const { onProgress, signal, timeoutMs, killGraceMs = 5000, cwd, env, logger } = context ?? {};

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let killGraceHandle: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killGraceHandle) clearTimeout(killGraceHandle);
      signal?.removeEventListener('abort', onAbort);
    };

    const settleResolve = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value.trim());
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const killChild = (force: boolean) => {
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
    };

    const onAbort = () => {
      killChild(false);
      settleReject(new Error('GitHub CLI command cancelled'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    if (timeoutMs) {
      timeoutHandle = setTimeout(() => {
        killChild(false);
        killGraceHandle = setTimeout(() => killChild(true), killGraceMs);
        settleReject(new Error(`GitHub CLI command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    logger?.info('gh_command_spawn_requested', { command, args });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onProgress?.(text);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        settleReject(new GhCliError('missing-cli', 'GitHub CLI `gh` is not installed. Install it and try again.', {
          command,
          args,
        }));
        return;
      }

      settleReject(new GhCliError('failed', `Failed to start GitHub CLI: ${error.message}`, {
        command,
        args,
        stderr,
        stdout,
      }));
    });

    child.on('close', (code) => {
      if (code === 0) {
        settleResolve(stdout);
        return;
      }

      const combined = `${stderr}\n${stdout}`.toLowerCase();
      let kind: GhFailureKind = 'failed';
      let message = `GitHub CLI command failed with exit code ${code ?? 'unknown'}`;

      if (combined.includes('not authenticated') || combined.includes('authentication failed') || combined.includes('could not find a credential')) {
        kind = 'unauthenticated';
        message = 'GitHub CLI is not authenticated. Run `gh auth login` (or `gh auth status`) and try again.';
      } else if (combined.includes('missing required scope') || combined.includes('resource not accessible by personal access token') || combined.includes('insufficient scopes') || combined.includes('forbidden')) {
        kind = 'forbidden';
        message = 'GitHub CLI is authenticated, but the token is missing the scope needed for Copilot premium request usage. Re-authenticate with the required GitHub Copilot permissions and retry. If needed, run `gh auth refresh -h github.com -s user`.';
      } else if (combined.includes('404 not found') || combined.includes('not found')) {
        kind = 'not-found';
        message = 'GitHub returned 404 for this Copilot usage request. Verify the username and requested date range, then retry.';
      } else if (combined.includes('403 forbidden') || combined.includes('forbidden')) {
        kind = 'forbidden';
        message = 'GitHub returned 403 for this Copilot usage request. Check `gh auth status`, ensure the authenticated account can read Copilot premium request usage, and if needed run `gh auth refresh -h github.com -s user`.';
      }

      settleReject(new GhCliError(kind, message, {
        command,
        args,
        exitCode: code,
        stdout,
        stderr,
      }));
    });
  });
}

export async function executeGhApi(
  args: string[],
  context?: ToolExecutionContext,
): Promise<string> {
  return executeGhCommand(['api', ...args], context);
}
