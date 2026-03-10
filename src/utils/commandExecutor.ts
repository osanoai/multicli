import { spawn } from "child_process";

// Detect Windows platform for shell compatibility
const isWindows = process.platform === "win32";

/**
 * Sanitize a single argument for safe use with cmd.exe (shell: true on Windows).
 * Uses correct cmd.exe escaping conventions:
 *   - `""` for literal double quotes (cmd.exe convention, not `\"`)
 *   - `%%` for literal percent signs (prevents env variable expansion)
 *   - `^` prefix for cmd.exe operators: & | < > ^
 */
export function sanitizeArgForCmd(arg: string): string {
  return arg
    .replace(/"/g, '""')               // cmd.exe double-quote escaping
    .replace(/%/g, '%%')               // prevent %VAR% expansion
    .replace(/[&|<>^]/g, c => `^${c}`) // caret-escape shell operators
  ;
}

export async function executeCommand(
  command: string,
  args: string[],
  onProgress?: (newOutput: string) => void,
  timeoutMs?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use shell: true on Windows to properly execute .cmd files and resolve PATH.
    // Sanitize args to prevent cmd.exe metacharacter injection.
    const safeArgs = isWindows ? args.map(sanitizeArgForCmd) : args;
    const childProcess = spawn(command, safeArgs, {
      env: process.env,
      shell: isWindows,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let isResolved = false;
    let lastReportedLength = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          childProcess.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    }

    childProcess.stdout.on("data", (data) => {
      stdout += data.toString();

      // Report new content if callback provided
      if (onProgress && stdout.length > lastReportedLength) {
        const newContent = stdout.substring(lastReportedLength);
        lastReportedLength = stdout.length;
        onProgress(newContent);
      }
    });


    // CLI level errors
    childProcess.stderr.on("data", (data) => {
      stderr += data.toString();
      // find RESOURCE_EXHAUSTED when gemini quota is exceeded
      if (stderr.includes("RESOURCE_EXHAUSTED")) {
        // Quota error details are captured in stderr and propagated via reject
      }
    });
    childProcess.on("error", (error) => {
      if (!isResolved) {
        isResolved = true;
        if (timer) clearTimeout(timer);
        reject(new Error(`Failed to spawn command: ${error.message}`));
      }
    });
    childProcess.on("close", (code) => {
      if (!isResolved) {
        isResolved = true;
        if (timer) clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const errorMessage = stderr.trim() || "Unknown error";
          reject(
            new Error(`Command failed with exit code ${code}: ${errorMessage}`),
          );
        }
      }
    });
  });
}