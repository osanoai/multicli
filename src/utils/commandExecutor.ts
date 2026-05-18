import { spawn } from "child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ToolExecutionContext } from "../execution.js";

// Detect Windows platform for shell compatibility
const isWindows = process.platform === "win32";
const SENSITIVE_VALUE_FLAGS = new Set(['--header', '-H', '--token', '--api-key', '--apikey', '--auth-token']);

const CREATE_PROCESS_AS_USER_W_FAILURE = 'CreateProcessAsUserW failed: 5';

export interface ExecuteCommandOptions extends ToolExecutionContext {
  /**
   * Codex-only opt-in on Windows (issue #138).
   * When true AND running on Windows AND the command resolves to an .exe on PATH,
   * spawn with shell:false + detached:true + windowsHide:true to bypass cmd.exe wrapping.
   * Falls back silently to the default shell:true path for .cmd/.bat or unresolved commands.
   * Only `executeCodexCLI` should set this.
   */
  windowsCodexNoShell?: boolean;
}

/**
 * Resolve a bare command (e.g. "codex") to an absolute executable path on Windows,
 * walking %PATH% × %PATHEXT% in deterministic order — same order semantics as `where`.
 * Returns { path, isCmd } where isCmd marks .cmd/.bat shims that must NOT take the
 * direct shell:false spawn path (Node CVE-2024-27980 / arg-quoting safety).
 */
export function resolveWindowsExecutable(command: string): { path: string; isCmd: boolean } | null {
  if (process.platform !== "win32") return null;

  const hasExt = /\.[a-zA-Z0-9]+$/.test(command);
  const hasSep = /[\\/]/.test(command);

  const pathDirs = (process.env.PATH ?? '').split(';').filter(Boolean);
  // Lower-case PATHEXT for deterministic, case-insensitive candidate paths.
  // Windows filesystem is case-insensitive, so this does not affect actual file lookup.
  const pathExt = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map((ext) => ext.toLowerCase());

  const candidates: string[] = [];

  if (hasSep) {
    if (hasExt) {
      candidates.push(command);
    } else {
      for (const ext of pathExt) candidates.push(command + ext);
    }
  } else {
    for (const dir of pathDirs) {
      if (hasExt) {
        candidates.push(path.join(dir, command));
      } else {
        for (const ext of pathExt) {
          candidates.push(path.join(dir, command + ext));
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const lower = candidate.toLowerCase();
        const isCmd = lower.endsWith('.cmd') || lower.endsWith('.bat');
        return { path: candidate, isCmd };
      }
    } catch {
      // ignore stat errors on inaccessible candidates
    }
  }

  return null;
}

export type CommandExecutionFailureKind =
  | "cancelled"
  | "timeout"
  | "spawn"
  | "quota"
  | "failed"
  | "no-output";

export class CommandExecutionError extends Error {
  constructor(
    public readonly kind: CommandExecutionFailureKind,
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
    this.name = "CommandExecutionError";
  }
}

/**
 * Format a single argument for safe use with cmd.exe (shell: true on Windows).
 * Ensures the argument survives cmd.exe parsing as one argv entry.
 *
 * Rules:
 * - Empty strings → `""` (otherwise lost entirely)
 * - Args with whitespace or quotes → wrapped in double quotes
 *   - Inside quotes: `"` → `""`, `%` → `%%`
 *   - Trailing backslashes doubled (prevents `\"` escaping the closing quote)
 *   - Shell operators (&|<>^) are literal inside quotes — no caret needed
 * - Args without whitespace or quotes → unquoted
 *   - `%` → `%%`, shell operators get caret-escaped
 */
export function sanitizeArgForCmd(arg: string): string {
  if (arg === '') return '""';

  // Newlines act as command separators in cmd.exe even inside double quotes.
  // Replace with spaces to preserve word boundaries safely.
  const sanitized = arg.replace(/[\r\n]+/g, ' ');

  const needsQuotes = /[\s"]/.test(sanitized);

  if (needsQuotes) {
    // Inside double quotes: only % and " need escaping.
    // Shell operators (&|<>^) are treated as literals by cmd.exe inside quotes.
    // Trailing backslashes must be doubled so they don't escape the closing quote
    // in the target process's CommandLineToArgvW parser.
    const escaped = sanitized
      .replace(/%/g, '%%')
      .replace(/"/g, '""')
      .replace(/\\+$/, m => m + m);
    return `"${escaped}"`;
  } else {
    // Unquoted: escape % and caret-escape shell operators (including parentheses)
    return sanitized
      .replace(/%/g, '%%')
      .replace(/[&|<>^()]/g, c => `^${c}`);
  }
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/(Authorization:\s*Bearer\s+)[^\s'"]+/gi, '$1[Redacted]')
    .replace(/(X-API-Key:\s*)[^\s'"]+/gi, '$1[Redacted]')
    .replace(/("authorization"\s*:\s*")([^"]+)(")/gi, '$1[Redacted]$3')
    .replace(/("token"\s*:\s*")([^"]+)(")/gi, '$1[Redacted]$3');
}

function redactArgValueForLogging(flag: string, value: string): string {
  if (flag === '--header' || flag === '-H') {
    return redactSensitiveText(value);
  }

  return '[Redacted]';
}

function redactArgsForLogging(args: string[]): string[] {
  const redacted: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equalsIndex = arg.indexOf('=');

    if (equalsIndex > 0) {
      const flag = arg.slice(0, equalsIndex);
      const value = arg.slice(equalsIndex + 1);
      if (SENSITIVE_VALUE_FLAGS.has(flag)) {
        redacted.push(`${flag}=${redactArgValueForLogging(flag, value)}`);
        continue;
      }
    }

    if (SENSITIVE_VALUE_FLAGS.has(arg) && index + 1 < args.length) {
      redacted.push(arg);
      redacted.push(redactArgValueForLogging(arg, args[index + 1]));
      index += 1;
      continue;
    }

    redacted.push(redactSensitiveText(arg));
  }

  return redacted;
}

function terminateWindowsProcessTree(pid: number, force: boolean) {
  const killArgs = ["/pid", String(pid), "/T"];
  if (force) {
    killArgs.push("/F");
  }

  const killer = spawn("taskkill", killArgs, {
    stdio: ["ignore", "ignore", "ignore"],
    shell: false,
  });

  killer.on("error", () => {
    // Best effort cleanup only.
  });
}

function terminateChildProcess(pid: number, force: boolean) {
  if (isWindows) {
    terminateWindowsProcessTree(pid, force);
    return;
  }

  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // Best effort cleanup only.
  }
}

export async function executeCommand(
  command: string,
  args: string[],
  options: ExecuteCommandOptions = {},
): Promise<string> {
  const {
    onProgress,
    signal,
    timeoutMs,
    killGraceMs = 5000,
    cwd,
    env,
    logger,
    windowsCodexNoShell,
  } = options;

  return new Promise((resolve, reject) => {
    // Evaluate platform at call time so tests can stub process.platform.
    const isWindowsRuntime = process.platform === "win32";
    // Codex-only Windows opt-in (#138): when the env flag is set AND command resolves
    // to a real .exe on PATH, bypass cmd.exe and spawn the .exe directly with
    // shell:false + detached:true + windowsHide:true. For .cmd/.bat shims or any
    // resolution failure, fall back silently to the default shell:true path so
    // arg-quoting safety + Node CVE-2024-27980 hardening are preserved.
    const noShellRequested = isWindowsRuntime && windowsCodexNoShell === true;
    const resolved = noShellRequested ? resolveWindowsExecutable(command) : null;
    const noShellActive = !!(resolved && !resolved.isCmd);

    const spawnCommand = noShellActive ? resolved!.path : command;
    const spawnShell = noShellActive ? false : isWindowsRuntime;
    const spawnDetached = noShellActive ? true : !isWindowsRuntime;
    const spawnArgs = noShellActive ? args : (isWindowsRuntime ? args.map(sanitizeArgForCmd) : args);

    const loggedArgs = redactArgsForLogging(args);
    const loggedSpawnArgs = redactArgsForLogging(spawnArgs);
    logger?.info("command_spawn_requested", {
      command,
      spawnCommand,
      args: loggedArgs,
      safeArgs: loggedSpawnArgs,
      cwd,
      timeoutMs,
      killGraceMs,
      platform: process.platform,
      shell: spawnShell,
      detached: spawnDetached,
      windowsCodexNoShell: noShellRequested,
      resolvedCommand: resolved?.path ?? null,
      resolvedIsCmd: resolved?.isCmd ?? null,
      effectiveShell: spawnShell,
      envKeys: env ? Object.keys(env).sort() : undefined,
    });
    const childProcess = spawn(spawnCommand, spawnArgs, {
      cwd,
      env: env ?? process.env,
      shell: spawnShell,
      stdio: ["ignore", "pipe", "pipe"],
      detached: spawnDetached,
      ...(noShellActive ? { windowsHide: true } : {}),
    });

    let stdout = "";
    let stderr = "";
    let isSettled = false;
    let lastReportedLength = 0;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let terminationStarted = false;
    let stdoutChunkCount = 0;
    let stderrChunkCount = 0;

    logger?.info("command_spawned", {
      command,
      args: loggedArgs,
      cwd,
      pid: childProcess.pid,
    });

    const clearRequestTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    const clearTerminationTimer = () => {
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }
    };

    const abortListener = () => {
        logger?.error("command_abort_signal_received", {
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          signalReason: signal?.reason,
        });
      beginTermination(
        new CommandExecutionError(
          "cancelled",
          "Command cancelled",
          {
            command,
            args: loggedArgs,
            stdout: redactSensitiveText(stdout),
            stderr: redactSensitiveText(stderr),
          },
        ),
      );
    };

    const settle = (error?: Error, output?: string) => {
      if (isSettled) return;

      isSettled = true;
      clearRequestTimer();
      signal?.removeEventListener("abort", abortListener);

      if (error) {
        reject(error);
      } else {
        resolve(output ?? "");
      }
    };

    const beginTermination = (error: Error) => {
      if (!terminationStarted && childProcess.pid) {
        terminationStarted = true;
        logger?.error("command_termination_started", {
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          reason: error.message,
          error,
        });
        terminateChildProcess(childProcess.pid, false);
        forceKillTimeoutId = setTimeout(() => {
          if (childProcess.pid) {
            logger?.error("command_termination_escalated", {
              command,
              args: loggedArgs,
              cwd,
              pid: childProcess.pid,
              killGraceMs,
            });
            terminateChildProcess(childProcess.pid, true);
          }
        }, killGraceMs);
      }

      settle(error);
    };

    signal?.addEventListener("abort", abortListener, { once: true });
    if (signal?.aborted) {
      abortListener();
      return;
    }

    if (timeoutMs && timeoutMs > 0) {
      logger?.debug("command_timeout_started", {
        command,
        args: loggedArgs,
        cwd,
        timeoutMs,
      });
      timeoutId = setTimeout(() => {
        logger?.error("command_timeout_elapsed", {
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          timeoutMs,
        });
        beginTermination(
          new CommandExecutionError(
            "timeout",
            `Command timed out after ${timeoutMs}ms`,
            {
              command,
              args: loggedArgs,
              stdout: redactSensitiveText(stdout),
              stderr: redactSensitiveText(stderr),
            },
          ),
        );
      }, timeoutMs);
    }

    childProcess.stdout?.on("data", (data) => {
      if (isSettled) return;
      const chunk = data.toString();
      stdout += chunk;
      stdoutChunkCount += 1;
      const loggedChunk = redactSensitiveText(chunk);
      logger?.debug("command_stdout_chunk", {
        command,
        args: loggedArgs,
        cwd,
        pid: childProcess.pid,
        chunkIndex: stdoutChunkCount,
        chunkLength: chunk.length,
        chunk: loggedChunk,
      });

      // Report new content if callback provided
      if (onProgress && stdout.length > lastReportedLength) {
        const newContent = stdout.substring(lastReportedLength);
        lastReportedLength = stdout.length;
        onProgress(newContent);
      }
    });


    // CLI level errors
    childProcess.stderr?.on("data", (data) => {
      if (isSettled) return;
      const chunk = data.toString();
      stderr += chunk;
      stderrChunkCount += 1;
      const loggedChunk = redactSensitiveText(chunk);
      logger?.debug("command_stderr_chunk", {
        command,
        args: loggedArgs,
        cwd,
        pid: childProcess.pid,
        chunkIndex: stderrChunkCount,
        chunkLength: chunk.length,
        chunk: loggedChunk,
      });

      if (stderr.includes("RESOURCE_EXHAUSTED")) {
        logger?.error("command_quota_exhausted", {
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          stderr: redactSensitiveText(stderr),
        });
        beginTermination(
          new CommandExecutionError(
            "quota",
            `Command failed due to quota exhaustion: ${redactSensitiveText(stderr).trim()}`,
            {
              command,
              args: loggedArgs,
              stdout: redactSensitiveText(stdout),
              stderr: redactSensitiveText(stderr),
            },
          ),
        );
      }
    });
    childProcess.on("error", (error) => {
      if (!isSettled) {
        clearRequestTimer();
        clearTerminationTimer();
        signal?.removeEventListener("abort", abortListener);
        logger?.error("command_spawn_failed", {
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          error,
        });
        settle(
          new CommandExecutionError(
            "spawn",
            `Failed to spawn command: ${error.message}`,
            {
              command,
              args: loggedArgs,
              stdout: redactSensitiveText(stdout),
              stderr: redactSensitiveText(stderr),
            },
          ),
        );
      }
    });
    childProcess.on("close", (code) => {
      clearRequestTimer();
      clearTerminationTimer();
      signal?.removeEventListener("abort", abortListener);

       logger?.info("command_closed", {
        command,
        args: loggedArgs,
        cwd,
        pid: childProcess.pid,
        exitCode: code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        stdoutChunkCount,
        stderrChunkCount,
        settledEarly: isSettled,
      });

      if (isSettled) {
        return;
      }

      if (code === 0) {
        const output = stdout.trim();

        // R3 (#138): Codex graceful-folds the Windows token-launch failure into
        // an exit-0 result. Detect the marker BEFORE the (output || !stderr.trim())
        // gate so the hint is surfaced even when stdout is empty and stderr alone
        // carries the marker. Single-note guarantee + empty-output guarantee.
        if (isWindowsRuntime) {
          const redactedStdoutLocal = redactSensitiveText(stdout);
          const redactedStderrLocal = redactSensitiveText(stderr);
          const markerFound =
            redactedStdoutLocal.includes(CREATE_PROCESS_AS_USER_W_FAILURE) ||
            redactedStderrLocal.includes(CREATE_PROCESS_AS_USER_W_FAILURE);
          if (markerFound) {
            const cause = "Codex exited 0 but reported a Windows token-launch failure (CreateProcessAsUserW failed: 5).";
            // Three-state action wording (#138 R3 follow-up):
            //   flag OFF                       → "try setting"
            //   flag ON + .exe resolved        → bypass attempted, failure is upstream
            //   flag ON + .cmd-only (fallback) → flag set but bypass could not activate
            const noShellActiveLocal = !!(resolved && !resolved.isCmd);
            const action = noShellRequested
              ? (noShellActiveLocal
                ? "MULTICLI_WINDOWS_CODEX_NO_SHELL=1 is already active but the failure persists — this likely needs an upstream Codex fix."
                : "MULTICLI_WINDOWS_CODEX_NO_SHELL=1 is set, but the bypass could not activate because codex.exe is not on PATH (only codex.cmd resolved). Install a build of Codex that exposes codex.exe, or stay on Tier 1.")
              : "Try setting MULTICLI_WINDOWS_CODEX_NO_SHELL=1. The workaround only takes effect when codex.exe is on PATH; npm-global installs that expose only codex.cmd will remain affected.";
            const hintBody = `${cause} ${action} See https://github.com/osanoai/multicli/issues/138.`;
            const note = `---\n[multicli] note: ${hintBody}`;
            const finalOutput = output ? `${output}\n\n${note}` : note;
            logger?.info("command_completed", {
              command,
              args: loggedArgs,
              cwd,
              pid: childProcess.pid,
              exitCode: code,
              resultKind: "success_with_issue138_note",
              outputLength: finalOutput.length,
            });
            settle(undefined, finalOutput);
            return;
          }
        }

        if (output || !stderr.trim()) {
          logger?.info("command_completed", {
            command,
            args: loggedArgs,
            cwd,
            pid: childProcess.pid,
            exitCode: code,
            resultKind: "success",
            outputLength: output.length,
          });
          settle(undefined, output);
          return;
        }

        logger?.error("command_completed_without_stdout", {
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          exitCode: code,
          stderr: redactSensitiveText(stderr),
        });
        settle(
          new CommandExecutionError(
            "no-output",
            `Command produced no output. stderr: ${redactSensitiveText(stderr).trim()}`,
            {
              command,
              args: loggedArgs,
              exitCode: code,
              stdout: redactSensitiveText(stdout),
              stderr: redactSensitiveText(stderr),
            },
          ),
        );
        return;
      }

      const redactedStdout = redactSensitiveText(stdout);
      const redactedStderr = redactSensitiveText(stderr);
      let errorMessage = redactedStderr.trim() || "Unknown error";

      // Issue #138: surface a known-Windows-issue hint when Codex's internal
      // child spawn fails with CreateProcessAsUserW failed: 5. Codex may emit
      // this string on either stream, so check both after redaction.
      if (
        isWindowsRuntime &&
        (redactedStdout.includes(CREATE_PROCESS_AS_USER_W_FAILURE) ||
          redactedStderr.includes(CREATE_PROCESS_AS_USER_W_FAILURE))
      ) {
        // Three-state hint wording (#138 R3 follow-up), parallel to success-path logic above.
        const noShellActiveErr = !!(resolved && !resolved.isCmd);
        errorMessage += noShellRequested
          ? (noShellActiveErr
            ? " (multicli hint: known Windows issue #138 — MULTICLI_WINDOWS_CODEX_NO_SHELL=1 workaround was already attempted; this likely needs an upstream Codex fix)"
            : " (multicli hint: known Windows issue #138 — MULTICLI_WINDOWS_CODEX_NO_SHELL=1 is set, but the bypass could not activate because codex.exe is not on PATH; only codex.cmd resolved)")
          : " (multicli hint: known Windows issue, see https://github.com/osanoai/multicli/issues/138 — try setting MULTICLI_WINDOWS_CODEX_NO_SHELL=1)";
      }
      logger?.error("command_failed", {
        command,
        args: loggedArgs,
        cwd,
        pid: childProcess.pid,
        exitCode: code,
        stderr: redactedStderr,
        stdout: redactedStdout,
      });
      settle(
        new CommandExecutionError(
          stderr.includes("RESOURCE_EXHAUSTED") ? "quota" : "failed",
          `Command failed with exit code ${code}: ${errorMessage}`,
          {
            command,
            args: loggedArgs,
            exitCode: code,
            stdout: redactedStdout,
            stderr: redactedStderr,
          },
        ),
      );
    });
  });
}
