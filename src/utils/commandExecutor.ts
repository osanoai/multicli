import { spawn } from "child_process";

// Detect Windows platform for shell compatibility
const isWindows = process.platform === "win32";

/**
 * Sanitize arguments for safe use with shell: true on Windows.
 * Prevents command injection via cmd.exe metacharacters (&, |, >, <, ^, %).
 */
function sanitizeWindowsArgs(args: string[]): string[] {
  if (!isWindows) return args;
  return args.map(arg =>
    arg
      .replace(/"/g, '\\"')   // escape quotes to prevent quote breakout
      .replace(/%/g, '%%')    // escape percent to prevent env var expansion
      .replace(/[&|<>^]/g, c => `^${c}`) // caret-escape cmd.exe operators
  );
}

export async function executeCommand(
  command: string,
  args: string[],
  onProgress?: (newOutput: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use shell: true on Windows to properly execute .cmd files and resolve PATH
    const safeArgs = sanitizeWindowsArgs(args);
    const childProcess = spawn(command, safeArgs, {
      env: process.env,
      shell: isWindows,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let isResolved = false;
    let lastReportedLength = 0;
    
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
        reject(new Error(`Failed to spawn command: ${error.message}`));
      }
    });
    childProcess.on("close", (code) => {
      if (!isResolved) {
        isResolved = true;
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