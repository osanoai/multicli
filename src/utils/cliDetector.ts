import { spawn } from "child_process";
import { CLI } from "../constants.js";

const isWindows = process.platform === "win32";

/**
 * Check if a command exists on the system PATH.
 * Uses `which` on Unix/macOS, `where` on Windows.
 * Always resolves to a boolean — never rejects.
 */
export async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const checker = isWindows ? "where" : "which";
      const child = spawn(checker, [command], {
        stdio: ["ignore", "ignore", "ignore"],
        shell: isWindows,
      });

      child.on("error", () => {
        resolve(false);
      });

      child.on("close", (code) => {
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}

export interface CliAvailability {
  gemini: boolean;
  codex: boolean;
  claude: boolean;
  opencode: boolean;
}

/**
 * Detect which of the three supported CLIs are available on the system.
 * Runs all three checks in parallel for speed.
 */
export async function detectAvailableClis(): Promise<CliAvailability> {
  if (process.env.QA_NO_CLIS === 'true') {
    return { gemini: false, codex: false, claude: false, opencode: false };
  }

  const [gemini, codex, claude, opencode] = await Promise.all([
    commandExists(CLI.COMMANDS.GEMINI),
    commandExists(CLI.COMMANDS.CODEX),
    commandExists(CLI.COMMANDS.CLAUDE),
    commandExists(CLI.COMMANDS.OPENCODE),
  ]);

  const availability: CliAvailability = { gemini, codex, claude, opencode };

  return availability;
}
