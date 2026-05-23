import { executeCommand, type ExecuteCommandOptions } from './commandExecutor.js';
import { CLI } from '../constants.js';
import { ToolExecutionContext } from '../execution.js';
import { resolveCodexNativeBinary, buildCodexLauncherEnv } from './codexLauncher.js';

// L5: warn once per process when the legacy MULTICLI_WINDOWS_CODEX_NO_SHELL
// flag is observed. Kept as no-op when launcher mimick is active.
let noShellDeprecationLogged = false;
/** @internal — test-only reset hook */
export function _resetNoShellDeprecationLog(): void {
  noShellDeprecationLogged = false;
}

/**
 * R2-b — codex stdout/stderr 의 ERROR JSON 명시 surface
 * (plan-review R1-R3 합의, 2026-05-21)
 *
 * Codex CLI 가 model_not_supported 등 invalid_request_error 를 stdout 으로
 * 반환할 때 이전엔 multicli 가 단순 string 반환 → LLM 은 호출 자체 실패를
 * 인지 못 함. CodexInvocationError throw 로 명시 surface 한다.
 *
 * Detection 전략 (Codex R1 F-02 + R2 F-05 합의):
 *   1. line-by-line JSON.parse 우선 + nested error.type 다중 키 매칭
 *   2. plain text 정규식 fallback (invalid_request_error 키워드)
 *   3. 향후 `--json` 플래그 활용은 별개 PR (DoD: §3-3 본 plan)
 */
export interface CodexErrorInfo {
  type: string;
  message: string;
  status?: number;
}

export class CodexInvocationError extends Error {
  constructor(
    public readonly codexError: CodexErrorInfo,
    public readonly raw: string,
  ) {
    super(`Codex returned ${codexError.type}: ${codexError.message}`);
    this.name = 'CodexInvocationError';
  }
}

function extractErrorInfo(parsed: unknown): CodexErrorInfo | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  const nestedError = (p.error && typeof p.error === 'object') ? p.error as Record<string, unknown> : null;

  if (nestedError && typeof nestedError.type === 'string') {
    return {
      type: nestedError.type,
      message: typeof nestedError.message === 'string' ? nestedError.message : 'Unknown Codex error',
      status: typeof p.status === 'number' ? p.status
        : typeof nestedError.status === 'number' ? nestedError.status
        : undefined,
    };
  }

  if (p.type === 'error') {
    return {
      type: typeof p.type === 'string' ? p.type : 'error',
      message: typeof p.message === 'string' ? p.message : 'Unknown Codex error',
      status: typeof p.status === 'number' ? p.status : undefined,
    };
  }

  return null;
}

export function detectCodexError(output: string): CodexErrorInfo | null {
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // "ERROR: {...}" 형태 (PoC #0 표준 패턴)
    const errorMatch = trimmed.match(/^ERROR:\s*(\{.+\})\s*$/);
    if (errorMatch) {
      try {
        const result = extractErrorInfo(JSON.parse(errorMatch[1]));
        if (result) return result;
      } catch { /* JSON parse 실패 시 다음 라인 */ }
    }

    // raw JSON line containing "type":"error"
    if (
      trimmed.startsWith('{')
      && trimmed.endsWith('}')
      && /"type"\s*:\s*"error"/.test(trimmed)
    ) {
      try {
        const result = extractErrorInfo(JSON.parse(trimmed));
        if (result) return result;
      } catch { /* JSON parse 실패 시 다음 라인 */ }
    }
  }

  // Fallback: plain text 안의 invalid_request_error 키워드
  const fallbackMatch = output.match(/invalid_request_error[:\s]+([^\n]+)/i);
  if (fallbackMatch) {
    return {
      type: 'invalid_request_error',
      message: fallbackMatch[1].trim(),
    };
  }

  return null;
}

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

  // Issue #138 follow-up (2026-05-23): codex.js launcher mimicking is the
  // empirical fix for Windows sandbox compatibility. Default-on when:
  //   - process.platform === 'win32'
  //   - resolveCodexNativeBinary() returns non-null (vendor codex.exe found)
  //   - MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN env flag is NOT set (opt-out)
  //
  // The legacy MULTICLI_WINDOWS_CODEX_NO_SHELL flag (PR #139) is kept as a
  // deprecated no-op when mimick is active — commandExecutor honors
  // codexLauncherMimick first. See tmp/R-20260523-085500-tier2-launcher-audit.md
  // for the 3-round empirical isolation that produced this fix shape.
  const launcherEscape = process.env.MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN === '1';
  const platformIsWindows = process.platform === 'win32';
  const native =
    platformIsWindows && !launcherEscape ? resolveCodexNativeBinary() : null;
  const noShellEnv = process.env.MULTICLI_WINDOWS_CODEX_NO_SHELL === '1';

  if (noShellEnv && !noShellDeprecationLogged) {
    noShellDeprecationLogged = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[multicli] MULTICLI_WINDOWS_CODEX_NO_SHELL is deprecated as of issue #138 ' +
        'follow-up. Codex now uses launcher-mimicking automatically on Windows. ' +
        'When launcher mimick is active (codex.exe resolves), this flag becomes a no-op. ' +
        'Set MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN=1 to opt out of the new path.',
    );
  }

  let codexContext: ExecuteCommandOptions | undefined = context;
  if (native || noShellEnv) {
    codexContext = { ...(context ?? {}) };
    if (native) {
      codexContext.codexLauncherMimick = {
        binaryPath: native.binaryPath,
        env: buildCodexLauncherEnv(process.env, native),
        pathDir: native.pathDir,
      };
    }
    if (noShellEnv) {
      codexContext.windowsCodexNoShell = true;
    }
  }

  const output = await executeCommand(CLI.COMMANDS.CODEX, args, codexContext);

  // R2-b: codex ERROR JSON detection — silent swallow 종결, throw 로 명시 surface
  const err = detectCodexError(output);
  if (err) {
    throw new CodexInvocationError(err, output);
  }

  return output;
}
