import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/utils/commandExecutor.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/utils/commandExecutor.js')>(
    '../../src/utils/commandExecutor.js'
  );
  return {
    ...actual,
    executeCommand: vi.fn().mockResolvedValue('mock response'),
  };
});

vi.mock('../../src/utils/codexLauncher.js', () => ({
  resolveCodexNativeBinary: vi.fn(),
  buildCodexLauncherEnv: vi.fn(),
}));

import { executeCodexCLI, WindowsSandboxError, _resetNoShellDeprecationLog } from '../../src/utils/codexExecutor.js';
import { executeCommand, CommandExecutionError } from '../../src/utils/commandExecutor.js';
import { resolveCodexNativeBinary, buildCodexLauncherEnv } from '../../src/utils/codexLauncher.js';

describe('codexExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // PR #139 환경변수가 host 세션에 설정되어 있어도 OFF 시나리오 기본 테스트를
    // isolate. ON 시나리오 검증은 tests/utils/commandExecutor.windowsCodexNoShell.test.ts.
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '');
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN', '');
    // L3 default: resolveCodexNativeBinary returns null so the launcher-mimick
    // branch is OFF for the existing arg-construction tests below. Individual
    // L3/L4 tests override this with mockReturnValueOnce.
    vi.mocked(resolveCodexNativeBinary).mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds correct base args (default sandbox workspace-write + approval_policy=never via -c, no --full-auto)', async () => {
    await executeCodexCLI('fix this bug', 'gpt-5.2-codex');

    expect(executeCommand).toHaveBeenCalledWith(
      'codex',
      [
        'exec', 'fix this bug',
        '--skip-git-repo-check',
        '--color', 'never',
        '-m', 'gpt-5.2-codex',
        '-s', 'workspace-write',
        '-c', 'approval_policy=never',
      ],
      undefined
    );
    const args = vi.mocked(executeCommand).mock.calls[0][1];
    expect(args).not.toContain('--full-auto');
    expect(args).not.toContain('-a'); // -a is rejected after `exec` in codex 0.137.0
  });

  it('overrides default sandbox when one is provided', async () => {
    await executeCodexCLI('task', 'gpt-5.2-codex', 'read-only');

    const args = vi.mocked(executeCommand).mock.calls[0][1];
    expect(args).toContain('-s');
    expect(args).toContain('read-only');
    expect(args).not.toContain('workspace-write');
  });

  it('passes approvalPolicy via -c approval_policy override when provided', async () => {
    await executeCodexCLI('task', 'gpt-5.2-codex', undefined, 'untrusted');

    const args = vi.mocked(executeCommand).mock.calls[0][1];
    expect(args).toContain('-c');
    expect(args).toContain('approval_policy=untrusted');
    expect(args).not.toContain('approval_policy=never');
  });

  it('includes both sandbox and approvalPolicy when both provided', async () => {
    await executeCodexCLI('task', 'gpt-5.2-codex', 'workspace-write', 'on-failure');

    const args = vi.mocked(executeCommand).mock.calls[0][1];
    expect(args).toContain('-s');
    expect(args).toContain('workspace-write');
    expect(args).toContain('-c');
    expect(args).toContain('approval_policy=on-failure');
  });

  it('passes onProgress callback through', async () => {
    const onProgress = vi.fn();
    await executeCodexCLI('task', 'gpt-5.2-codex', undefined, undefined, { onProgress });

    // L3: context is now always an object (codexLauncherMimick / windowsCodexNoShell
    // may attach), so we verify the onProgress field rather than exact context match.
    const callArgs = vi.mocked(executeCommand).mock.calls[0];
    expect(callArgs[0]).toBe('codex');
    expect(callArgs[2]?.onProgress).toBe(onProgress);
  });
});

describe('codexExecutor — codex.js launcher mimick (L3 + L4)', () => {
  const ORIGINAL_PLATFORM = process.platform;
  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  const fakeNative = {
    binaryPath: 'C:/pkg/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
    pathDir: 'C:/pkg/vendor/x86_64-pc-windows-msvc/codex-path',
    packageRoot: 'C:/pkg',
  };

  const fakeMimickEnv = {
    PATH: `${fakeNative.pathDir};C:/Windows/System32`,
    CODEX_MANAGED_BY_NPM: '1',
    CODEX_MANAGED_PACKAGE_ROOT: fakeNative.packageRoot,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '');
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN', '');
    setPlatform('win32');
    vi.mocked(resolveCodexNativeBinary).mockReturnValue(fakeNative);
    vi.mocked(buildCodexLauncherEnv).mockReturnValue(fakeMimickEnv);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
  });

  it('attaches codexLauncherMimick context on win32 when native resolve succeeds', async () => {
    await executeCodexCLI('task', 'gpt-5.4');

    const passedContext = vi.mocked(executeCommand).mock.calls[0][2];
    expect(passedContext?.codexLauncherMimick).toEqual({
      binaryPath: fakeNative.binaryPath,
      env: fakeMimickEnv,
      pathDir: fakeNative.pathDir,
    });
  });

  it('calls buildCodexLauncherEnv with process.env and the resolved native package', async () => {
    await executeCodexCLI('task', 'gpt-5.4');

    expect(buildCodexLauncherEnv).toHaveBeenCalledTimes(1);
    const [baseEnv, native] = vi.mocked(buildCodexLauncherEnv).mock.calls[0];
    expect(native).toBe(fakeNative);
    expect(baseEnv).toBe(process.env);
  });

  it('does NOT attach codexLauncherMimick on non-win32 platform', async () => {
    setPlatform('linux');

    await executeCodexCLI('task', 'gpt-5.4');

    const passedContext = vi.mocked(executeCommand).mock.calls[0][2];
    expect(passedContext?.codexLauncherMimick).toBeUndefined();
    expect(resolveCodexNativeBinary).not.toHaveBeenCalled();
  });

  it('does NOT attach codexLauncherMimick when resolveCodexNativeBinary returns null', async () => {
    vi.mocked(resolveCodexNativeBinary).mockReturnValueOnce(null);

    await executeCodexCLI('task', 'gpt-5.4');

    const passedContext = vi.mocked(executeCommand).mock.calls[0][2];
    expect(passedContext?.codexLauncherMimick).toBeUndefined();
  });

  it('L4: MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN=1 opts out of launcher mimick', async () => {
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN', '1');

    await executeCodexCLI('task', 'gpt-5.4');

    const passedContext = vi.mocked(executeCommand).mock.calls[0][2];
    expect(passedContext?.codexLauncherMimick).toBeUndefined();
    expect(resolveCodexNativeBinary).not.toHaveBeenCalled();
  });

  it('forwards windowsCodexNoShell as no-op alongside mimick (mimick wins)', async () => {
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '1');

    await executeCodexCLI('task', 'gpt-5.4');

    const passedContext = vi.mocked(executeCommand).mock.calls[0][2];
    expect(passedContext?.codexLauncherMimick).toBeDefined();
    expect(passedContext?.windowsCodexNoShell).toBe(true);
  });

  it('preserves caller-supplied context fields (onProgress, signal) when attaching mimick', async () => {
    const onProgress = vi.fn();
    await executeCodexCLI('task', 'gpt-5.4', undefined, undefined, { onProgress });

    const passedContext = vi.mocked(executeCommand).mock.calls[0][2];
    expect(passedContext?.onProgress).toBe(onProgress);
    expect(passedContext?.codexLauncherMimick).toBeDefined();
  });
});

describe('codexExecutor — L5 NO_SHELL deprecation log', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    warnSpy.mockClear();
    _resetNoShellDeprecationLog();
    vi.clearAllMocks();
    vi.mocked(resolveCodexNativeBinary).mockReturnValue(null);
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '');
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('emits a deprecation warning to stderr on first NO_SHELL=1 call', async () => {
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '1');
    await executeCodexCLI('task', 'gpt-5.4');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('MULTICLI_WINDOWS_CODEX_NO_SHELL');
    expect(msg).toContain('deprecated');
    expect(msg).toContain('MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN');
  });

  it('does NOT re-emit on subsequent NO_SHELL=1 calls (once-per-process)', async () => {
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '1');
    await executeCodexCLI('task1', 'gpt-5.4');
    await executeCodexCLI('task2', 'gpt-5.4');
    await executeCodexCLI('task3', 'gpt-5.4');

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT emit when NO_SHELL is unset', async () => {
    await executeCodexCLI('task', 'gpt-5.4');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

/**
 * R0 — executeCodexCLI 반환 계약 (plan-review R1-R3 합의, 2026-05-21).
 *
 * 계약:
 *   성공 시 → Promise<string> (codex stdout)
 *   실패 시 → throw (CommandExecutionError 또는 후속 R2-b의 CodexInvocationError)
 *
 * 근거: 단일 호출자(src/tools/ask-codex.tool.ts:30) + 도구 레이어 catch
 * (src/serverApp.ts:708-719)가 throw를 isError:true MCP 응답으로 surface.
 * 본 계약은 이후 R2-b ERROR JSON detection 변경의 기준선.
 */
describe('codexExecutor — return contract (R0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('성공 시 executeCommand의 string 결과를 그대로 반환한다', async () => {
    vi.mocked(executeCommand).mockResolvedValueOnce('codex stdout response');

    const result = await executeCodexCLI('task', 'gpt-5.2-codex');

    expect(typeof result).toBe('string');
    expect(result).toBe('codex stdout response');
  });

  it('executeCommand가 CommandExecutionError 를 throw 하면 동일 인스턴스로 propagate 한다', async () => {
    const err = new CommandExecutionError('failed', 'simulated codex spawn failure', {
      command: 'codex',
      args: ['exec'],
    });
    vi.mocked(executeCommand).mockRejectedValueOnce(err);

    await expect(executeCodexCLI('task', 'gpt-5.2-codex')).rejects.toBe(err);
  });

  it('executeCommand가 일반 Error 를 throw 하면 그대로 propagate 한다', async () => {
    const err = new Error('arbitrary failure');
    vi.mocked(executeCommand).mockRejectedValueOnce(err);

    await expect(executeCodexCLI('task', 'gpt-5.2-codex')).rejects.toThrow('arbitrary failure');
  });

  it('빈 string("") 도 string 계약 위반 없이 그대로 반환한다 (R2-b detection 이전의 baseline)', async () => {
    vi.mocked(executeCommand).mockResolvedValueOnce('');

    const result = await executeCodexCLI('task', 'gpt-5.2-codex');

    expect(typeof result).toBe('string');
    expect(result).toBe('');
  });
});

describe('codexExecutor — Windows sandbox refresh surfacing', () => {
  const ORIGINAL_PLATFORM = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '');
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_LEGACY_SPAWN', '');
    vi.mocked(resolveCodexNativeBinary).mockReturnValue(null);
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
  });

  it('throws WindowsSandboxError (no retry) when the run fails with the sandbox refresh marker', async () => {
    const err = new CommandExecutionError('failed', 'Command failed: windows sandbox: spawn setup refresh', {
      command: 'codex',
      args: ['exec'],
      stderr: 'windows sandbox: spawn setup refresh',
    });
    vi.mocked(executeCommand).mockRejectedValueOnce(err);

    await expect(executeCodexCLI('read a file', 'gpt-5.4')).rejects.toBeInstanceOf(WindowsSandboxError);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('surfaces an actionable WindowsSandboxError message that mentions inlining', async () => {
    const err = new CommandExecutionError('failed', 'windows sandbox: spawn setup refresh', {
      command: 'codex',
      args: ['exec'],
      stderr: 'windows sandbox: spawn setup refresh',
    });
    vi.mocked(executeCommand).mockRejectedValueOnce(err);

    await expect(executeCodexCLI('read a file', 'gpt-5.4')).rejects.toThrow(/inline/i);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('(F-04) does NOT throw when the marker only appears in successful output', async () => {
    const out = 'Audit of the guide: it documents `windows sandbox: spawn setup refresh`. All good.';
    vi.mocked(executeCommand).mockResolvedValueOnce(out);

    const result = await executeCodexCLI('summarize docs/guide.md', 'gpt-5.4');

    expect(result).toBe(out);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('propagates the original error unchanged on non-Windows platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const err = new CommandExecutionError('failed', 'windows sandbox: spawn setup refresh', {
      command: 'codex',
      args: ['exec'],
      stderr: 'windows sandbox: spawn setup refresh',
    });
    vi.mocked(executeCommand).mockRejectedValueOnce(err);

    await expect(executeCodexCLI('task', 'gpt-5.4')).rejects.toBe(err);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });
});

/**
 * R2-b — codexExecutor ERROR JSON detection (plan-review R1-R3 합의, 2026-05-21)
 *
 * Codex CLI 가 model_not_supported 등 ERROR 를 stdout 에 JSON 으로 반환하면
 * 이전엔 multicli 가 string 으로 swallow → LLM 은 "정상 응답인데 작업 실패" 인지
 * "호출 자체 실패" 인지 구분 불가. CodexInvocationError throw 로 명시 surface.
 */
describe('codexExecutor — ERROR JSON detection (R2-b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MULTICLI_WINDOWS_CODEX_NO_SHELL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('PoC #0 형태 ERROR JSON ("ERROR: {...invalid_request_error...}") 는 throw 된다', async () => {
    const errOutput = `OpenAI Codex v0.131.0
---------
user
test
ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5-medium' model is not supported when using Codex with a ChatGPT account."}}`;
    vi.mocked(executeCommand).mockResolvedValueOnce(errOutput);

    const { CodexInvocationError } = await import('../../src/utils/codexExecutor.js');

    await expect(executeCodexCLI('task', 'gpt-5.5-medium')).rejects.toBeInstanceOf(
      CodexInvocationError,
    );
  });

  it('CodexInvocationError 는 codex error 정보를 노출한다 (type/message)', async () => {
    const errOutput = `ERROR: {"type":"error","error":{"type":"invalid_request_error","message":"model X not supported"}}`;
    vi.mocked(executeCommand).mockResolvedValueOnce(errOutput);

    const { CodexInvocationError } = await import('../../src/utils/codexExecutor.js');

    try {
      await executeCodexCLI('task', 'gpt-x');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CodexInvocationError);
      const err = e as InstanceType<typeof CodexInvocationError>;
      expect(err.codexError.type).toContain('invalid_request_error');
      expect(err.codexError.message).toContain('not supported');
      expect(err.message).toContain('not supported');
    }
  });

  it('plain text 안의 "invalid_request_error" 도 fallback 으로 detect 된다', async () => {
    const errOutput = 'something happened: invalid_request_error: model not found';
    vi.mocked(executeCommand).mockResolvedValueOnce(errOutput);

    const { CodexInvocationError } = await import('../../src/utils/codexExecutor.js');

    await expect(executeCodexCLI('task', 'gpt-x')).rejects.toBeInstanceOf(
      CodexInvocationError,
    );
  });

  it('정상 응답은 ERROR detection 에 걸리지 않고 그대로 string 반환 (계약 유지)', async () => {
    vi.mocked(executeCommand).mockResolvedValueOnce('Normal codex response: task completed.');

    const result = await executeCodexCLI('task', 'gpt-5.2-codex');

    expect(typeof result).toBe('string');
    expect(result).toBe('Normal codex response: task completed.');
  });

  it('빈 string 응답은 ERROR detection 에 걸리지 않고 그대로 반환 (baseline 유지)', async () => {
    vi.mocked(executeCommand).mockResolvedValueOnce('');

    const result = await executeCodexCLI('task', 'gpt-5.2-codex');

    expect(result).toBe('');
  });

  it('multicli note ([multicli] note: ...) 가 응답 끝에 있어도 ERROR 가 검출되면 throw 한다', async () => {
    const errOutput = `ERROR: {"type":"error","error":{"type":"invalid_request_error","message":"bad model"}}

[multicli] note: Codex exited 0 but reported a Windows token-launch failure.`;
    vi.mocked(executeCommand).mockResolvedValueOnce(errOutput);

    const { CodexInvocationError } = await import('../../src/utils/codexExecutor.js');

    await expect(executeCodexCLI('task', 'gpt-x')).rejects.toBeInstanceOf(
      CodexInvocationError,
    );
  });
});
