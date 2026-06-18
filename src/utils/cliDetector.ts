import { spawn } from "child_process";
import { CLI } from "../constants.js";
import type { Logger } from "../logger.js";

const isWindows = process.platform === "win32";

/**
 * Check if a command exists on the system PATH.
 * Uses `which` on Unix/macOS, `where` on Windows.
 * Always resolves to a boolean — never rejects.
 */
export async function commandExists(
  command: string,
  timeoutMs?: number,
  logger?: Logger,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const checker = isWindows ? "where" : "which";
      logger?.debug('cli_probe_started', {
        command,
        checker,
        timeoutMs,
      });
      const child = spawn(checker, [command], {
        stdio: ["ignore", "ignore", "ignore"],
        shell: isWindows,
      });
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          logger?.error('cli_probe_timed_out', {
            command,
            checker,
            timeoutMs,
          });
          resolve(false);
        }, timeoutMs);
      }

      child.on("error", (error) => {
        cleanup();
        logger?.error('cli_probe_spawn_failed', {
          command,
          checker,
          error,
        });
        resolve(false);
      });

      child.on("close", (code) => {
        cleanup();
        logger?.debug('cli_probe_finished', {
          command,
          checker,
          exitCode: code,
          exists: code === 0,
        });
        resolve(code === 0);
      });
    } catch (error) {
      logger?.error('cli_probe_threw', {
        command,
        error,
      });
      resolve(false);
    }
  });
}

export interface CliAvailability {
  antigravity: boolean;
  gemini: boolean;
  codex: boolean;
  claude: boolean;
  opencode: boolean;
}

/**
 * Detect which supported CLIs are available on the system.
 * Runs all checks in parallel for speed.
 */
export async function detectAvailableClis(
  timeoutMs?: number,
  logger?: Logger,
): Promise<CliAvailability> {
  if (process.env.QA_NO_CLIS === 'true') {
    logger?.info('cli_detection_skipped', {
      reason: 'QA_NO_CLIS=true',
    });
    return { antigravity: false, gemini: false, codex: false, claude: false, opencode: false };
  }

  logger?.info('cli_detection_started', { timeoutMs });
  const [antigravity, codex, claude, opencode] = await Promise.all([
    commandExists(CLI.COMMANDS.ANTIGRAVITY, timeoutMs, logger),
    commandExists(CLI.COMMANDS.CODEX, timeoutMs, logger),
    commandExists(CLI.COMMANDS.CLAUDE, timeoutMs, logger),
    commandExists(CLI.COMMANDS.OPENCODE, timeoutMs, logger),
  ]);

  const gemini = antigravity;
  const availability: CliAvailability = { antigravity, gemini, codex, claude, opencode };
  logger?.info('cli_detection_finished', { availability });

  return availability;
}
