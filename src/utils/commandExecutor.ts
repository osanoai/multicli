import { spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { ToolExecutionContext } from "../execution.js";
import { getRunsDir } from "../service/paths.js";

// Detect Windows platform for shell compatibility
const isWindows = process.platform === "win32";
const SENSITIVE_VALUE_FLAGS = new Set(['--header', '-H', '--token', '--api-key', '--apikey', '--auth-token']);

export type CommandExecutionFailureKind =
  | "cancelled"
  | "timeout"
  | "spawn"
  | "quota"
  | "failed"
  | "no-output";

export type CommandErrorType =
  | "RESOURCE_EXHAUSTED"
  | "AUTH_ERROR"
  | "MODEL_NOT_FOUND"
  | "TIMEOUT"
  | "SPAWN"
  | "CANCELLED"
  | "FAILED"
  | "NO_OUTPUT";

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
      runId?: string;
    },
  ) {
    const errorType = mapKindToErrorType(kind, details.stderr || "", details.stdout || "");
    const retryable = isRetryable(errorType);
    const retryAfter = parseRetryAfter(details.stderr || "");

    let finalMessage = message;
    if (errorType === "MODEL_NOT_FOUND") {
      finalMessage += " (Note: model IDs are tool-specific; ensure you are using a model ID supported by this specific CLI tool)";
    }

    const structured = {
      status: details.exitCode ?? -1,
      error_type: errorType,
      retryable,
      retry_after_seconds: retryAfter,
      command: details.command,
      args: redactArgsForLogging(details.args),
      exit_code: details.exitCode,
      stdout_tail: tail(details.stdout, 500),
      stderr_tail: tail(details.stderr, 500),
      run_id: details.runId
    };

    super(`${finalMessage}\n\n\`\`\`json\n${JSON.stringify(structured, null, 2)}\n\`\`\``);
    this.name = "CommandExecutionError";
  }
}

function mapKindToErrorType(kind: CommandExecutionFailureKind, stderr: string, stdout: string): CommandErrorType {
  if (kind === "timeout") return "TIMEOUT";
  if (kind === "spawn") return "SPAWN";
  if (kind === "cancelled") return "CANCELLED";
  if (kind === "no-output") return "NO_OUTPUT";

  const combined = (stderr + "\n" + stdout).toLowerCase();

  if (combined.includes("resource_exhausted") ||
      combined.includes("429") ||
      combined.includes("model_capacity_exhausted") ||
      combined.includes("no capacity available") ||
      combined.includes("rate limit") ||
      combined.includes("quota")) {
    return "RESOURCE_EXHAUSTED";
  }

  if (combined.includes("auth") ||
      combined.includes("invalid api key") ||
      combined.includes("api_key_invalid") ||
      combined.includes("unauthorized")) {
    return "AUTH_ERROR";
  }

  if (combined.includes("model not found") || combined.includes("404")) {
    return "MODEL_NOT_FOUND";
  }

  return "FAILED";
}

function isRetryable(type: CommandErrorType): boolean {
  return type === "RESOURCE_EXHAUSTED" || type === "TIMEOUT";
}

function parseRetryAfter(stderr: string): number | null {
  const match = stderr.match(/retry after (\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function tail(text: string | undefined, limit: number): string {
  if (!text) return "";
  const redacted = redactSensitiveText(text);
  if (redacted.length <= limit) return redacted;
  return "..." + redacted.slice(-limit);
}

async function recordRun(
  runId: string,
  command: string,
  args: string[],
  cwd: string | undefined,
  status: string,
  errorType: CommandErrorType | undefined,
  exitCode: number | null | undefined,
  stdout: string,
  stderr: string
) {
  try {
    const runsDir = getRunsDir();
    await mkdir(runsDir, { recursive: true });

    const runData = {
      run_id: runId,
      timestamp: new Date().toISOString(),
      command,
      args: redactArgsForLogging(args),
      cwd: cwd || process.cwd(),
      status,
      error_type: errorType,
      exit_code: exitCode,
      stdout_tail: tail(stdout, 1000),
      stderr_tail: tail(stderr, 1000),
    };

    await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(runData, null, 2));
  } catch (error) {
    // Best effort, don't crash the command execution
  }
}

/**
 * Format a single argument for safe use with cmd.exe (shell: true on Windows).
 * Ensures the argument survives cmd.exe parsing as one argv entry.
 */
export function sanitizeArgForCmd(arg: string): string {
  if (arg === '') return '""';

  const sanitized = arg.replace(/[\r\n]+/g, ' ');
  const needsQuotes = /[\s"]/.test(sanitized);

  if (needsQuotes) {
    const escaped = sanitized
      .replace(/%/g, '%%')
      .replace(/"/g, '""')
      .replace(/\\+$/, m => m + m);
    return `"${escaped}"`;
  } else {
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
  if (force) killArgs.push("/F");
  const killer = spawn("taskkill", killArgs, { stdio: ["ignore", "ignore", "ignore"], shell: false });
  killer.on("error", () => {});
}

function terminateChildProcess(pid: number, force: boolean) {
  if (isWindows) {
    terminateWindowsProcessTree(pid, force);
    return;
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch {}
}

export async function executeCommand(
  command: string,
  args: string[],
  options: ToolExecutionContext = {},
): Promise<string> {
  const {
    onProgress,
    signal,
    timeoutMs,
    killGraceMs = 5000,
    cwd,
    env,
    logger,
  } = options;
  const runId = randomUUID();

  return new Promise((resolve, reject) => {
    const safeArgs = isWindows ? args.map(sanitizeArgForCmd) : args;
    const loggedArgs = redactArgsForLogging(args);
    const loggedSafeArgs = redactArgsForLogging(safeArgs);

    logger?.info("command_spawn_requested", {
      runId,
      command,
      args: loggedArgs,
      safeArgs: loggedSafeArgs,
      cwd,
      timeoutMs,
      killGraceMs,
      platform: process.platform,
      shell: isWindows,
      detached: !isWindows,
      envKeys: env ? Object.keys(env).sort() : undefined,
    });

    const childProcess = spawn(command, safeArgs, {
      cwd,
      env: env ?? process.env,
      shell: isWindows,
      stdio: ["ignore", "pipe", "pipe"],
      detached: !isWindows,
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
      runId,
      command,
      args: loggedArgs,
      cwd,
      pid: childProcess.pid,
    });

    const clearRequestTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
    const clearTerminationTimer = () => {
      if (forceKillTimeoutId) clearTimeout(forceKillTimeoutId);
    };

    const settle = (error?: Error, output?: string, exitCode?: number | null) => {
      if (isSettled) return;
      isSettled = true;
      clearRequestTimer();
      signal?.removeEventListener("abort", abortListener);

      const status = error ? "failed" : "success";
      let errorType: CommandErrorType | undefined;
      if (error instanceof CommandExecutionError) {
        errorType = mapKindToErrorType(error.kind, stderr, stdout);
      } else if (error) {
        errorType = "FAILED";
      }

      void recordRun(runId, command, args, cwd, status, errorType, exitCode, stdout, stderr);

      if (error) reject(error);
      else resolve(output ?? "");
    };

    const beginTermination = (error: Error) => {
      if (!terminationStarted && childProcess.pid) {
        terminationStarted = true;
        logger?.error("command_termination_started", {
          runId,
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
              runId,
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

    const abortListener = () => {
      logger?.error("command_abort_signal_received", {
        runId,
        command,
        args: loggedArgs,
        cwd,
        pid: childProcess.pid,
        signalReason: signal?.reason,
      });
      beginTermination(
        new CommandExecutionError("cancelled", "Command cancelled", {
          runId,
          command,
          args: loggedArgs,
          stdout,
          stderr,
        }),
      );
    };

    signal?.addEventListener("abort", abortListener, { once: true });
    if (signal?.aborted) {
      abortListener();
      return;
    }

    if (timeoutMs && timeoutMs > 0) {
      logger?.debug("command_timeout_started", {
        runId,
        command,
        args: loggedArgs,
        cwd,
        timeoutMs,
      });
      timeoutId = setTimeout(() => {
        logger?.error("command_timeout_elapsed", {
          runId,
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          timeoutMs,
        });
        beginTermination(
          new CommandExecutionError("timeout", `Command timed out after ${timeoutMs}ms`, {
            runId,
            command,
            args: loggedArgs,
            stdout,
            stderr,
          }),
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
        runId,
        command,
        args: loggedArgs,
        cwd,
        pid: childProcess.pid,
        chunkIndex: stdoutChunkCount,
        chunkLength: chunk.length,
        chunk: loggedChunk,
      });
      if (onProgress && stdout.length > lastReportedLength) {
        const newContent = stdout.substring(lastReportedLength);
        lastReportedLength = stdout.length;
        onProgress(newContent);
      }
    });

    childProcess.stderr?.on("data", (data) => {
      if (isSettled) return;
      const chunk = data.toString();
      stderr += chunk;
      stderrChunkCount += 1;
      const loggedChunk = redactSensitiveText(chunk);
      logger?.debug("command_stderr_chunk", {
        runId,
        command,
        args: loggedArgs,
        cwd,
        pid: childProcess.pid,
        chunkIndex: stderrChunkCount,
        chunkLength: chunk.length,
        chunk: loggedChunk,
      });
      if (mapKindToErrorType("failed", stderr, stdout) === "RESOURCE_EXHAUSTED") {
        logger?.error("command_quota_exhausted", {
          runId,
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          stderr: redactSensitiveText(stderr),
        });
        beginTermination(
          new CommandExecutionError(
            "quota",
            `Quota exhausted: ${redactSensitiveText(stderr).trim()}`,
            { runId, command, args: loggedArgs, stdout, stderr },
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
          runId,
          command,
          args: loggedArgs,
          cwd,
          pid: childProcess.pid,
          error,
        });
        settle(
          new CommandExecutionError("spawn", `Failed to spawn command: ${error.message}`, {
            runId,
            command,
            args: loggedArgs,
            stdout,
            stderr,
          }),
        );
      }
    });

    childProcess.on("close", (code) => {
      clearRequestTimer();
      clearTerminationTimer();
      signal?.removeEventListener("abort", abortListener);

      logger?.info("command_closed", {
        runId,
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
        if (output || !stderr.trim()) {
          logger?.info("command_completed", {
            runId,
            command,
            args: loggedArgs,
            cwd,
            pid: childProcess.pid,
            exitCode: code,
            resultKind: "success",
            outputLength: output.length,
          });
          settle(undefined, output, code);
          return;
        }

        logger?.error("command_completed_without_stdout", {
          runId,
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
            { runId, command, args: loggedArgs, exitCode: code, stdout, stderr },
          ),
          undefined,
          code,
        );
        return;
      }

      const exhausted = mapKindToErrorType("failed", stderr, stdout) === "RESOURCE_EXHAUSTED";
      const redactedStdout = redactSensitiveText(stdout);
      const redactedStderr = redactSensitiveText(stderr);
      const errorMessage = redactedStderr.trim() || "Unknown error";
      logger?.error("command_failed", {
        runId,
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
          exhausted ? "quota" : "failed",
          exhausted
            ? `Quota exhausted: ${redactedStderr.trim()}`
            : `Command failed with code ${code}: ${errorMessage}`,
          { runId, command, args: loggedArgs, exitCode: code, stdout, stderr },
        ),
        undefined,
        code,
      );
    });
  });
}
